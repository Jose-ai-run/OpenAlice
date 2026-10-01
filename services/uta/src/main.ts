/**
 * UTA service entry — co-located v1.
 *
 * Owns the trading domain (broker connections, git-like approval state,
 * snapshots, FX). Binds to 127.0.0.1 by default (`OPENALICE_UTA_BIND_HOST`
 * overrides it — refused without `OPENALICE_UTA_TOKENS_FILE`, see
 * domain/trading/auth/deployment-safety.ts) — Alice talks to UTA via
 * `OPENALICE_UTA_URL`.
 *
 * Startup path is also the reload path: when broker config changes, Alice
 * touches `data/control/restart-uta.flag`, Guardian SIGTERMs this process
 * and respawns. There is no in-process hot-reload code path.
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { loadConfig, readUTAsConfig, purgeEphemeralUTAs, type UTAConfig } from '@/core/config.js'
import { parseDuration } from '@/core/duration.js'
import { createEventLog } from '@/core/event-log.js'
import { ToolCenter } from '@/core/tool-center.js'
import {
  UTAManager,
  createSnapshotService,
  createSnapshotScheduler,
} from './domain/trading/index.js'
import { FxService } from './domain/trading/fx-service.js'
import {
  getSDKExecutor,
  buildRouteMap,
  SDKCurrencyClient,
} from '@/domain/market-data/client/typebb/index.js'
import type { CurrencyClientLike } from '@/domain/market-data/client/types.js'
import { buildSDKCredentials } from '@/domain/market-data/credential-map.js'
import { startOrderSyncPoller } from './domain/trading/order-sync-poller.js'
import { buildKeylessDataUTAs } from './domain/trading/keyless-data-sources.js'
import { createTradingRoutes } from './http/routes-trading.js'
import { createSimulatorRoutes } from './http/routes-simulator.js'
import { createRiskRoutes } from './http/routes-risk.js'
import { utaAuthMiddleware } from './http/auth.js'
import { engineAccountGuard } from './http/engine-account-guard.js'
import { checkRiskEngineDeploymentSafety } from './domain/trading/risk/deployment-safety.js'
import {
  checkUtaAuthDeploymentSafety,
  checkTokensFileDevLocation,
  resolveUtaBindHost,
} from './domain/trading/auth/deployment-safety.js'
import { resolveUtaTokensFilePath } from './domain/trading/auth/tokens-file.js'
import { runAuditAndEnforce } from './domain/trading/risk/audit/audit-runner.js'
import { userDataHome } from '@/core/paths.js'
import type { UTAEngineContext } from './types.js'

const UTA_PORT = Number(process.env['OPENALICE_UTA_PORT'] ?? 47333)
const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000  // 6h
const AUDIT_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24h — [PROPUESTA] Fase 4c (A5, ADR-0010)

export async function startUTAService(): Promise<void> {
  const startedAt = new Date().toISOString()
  console.log(`[uta] bootstrap @ ${startedAt}`)

  // [PROPUESTA] Fase 4a deployment-safety gate — before anything else:
  // a configured risk policy that isn't actually enforced (flag off) is a
  // silent fail-open, not a disabled feature. See docs/risk-engine.md.
  const riskSafety = checkRiskEngineDeploymentSafety()
  if (!riskSafety.ok) {
    console.error(`[uta] fatal: ${riskSafety.error}`)
    process.exit(1)
  }
  if (riskSafety.warn) console.warn(riskSafety.warn)

  // [PROPUESTA] Fase 4b auth deployment-safety gate — a non-loopback bind
  // with no tokens file would expose the trading-write chokepoint with no
  // authentication. See docs/uta-auth.md.
  const authSafety = checkUtaAuthDeploymentSafety()
  if (!authSafety.ok) {
    console.error(`[uta] fatal: ${authSafety.error}`)
    process.exit(1)
  }
  if (authSafety.warn) console.warn(authSafety.warn)

  // [PROPUESTA] Fase 4b corrección A.1 — resolved exactly ONCE, here, at
  // boot. `utaAuthMiddleware` receives this fixed value and never
  // re-reads the env var itself: a later read failure must deny every
  // request, never silently fall back to compatibility mode. See
  // http/auth.ts's module docstring.
  const utaTokensPath = resolveUtaTokensFilePath()
  if (utaTokensPath) {
    const locationWarning = checkTokensFileDevLocation(utaTokensPath, userDataHome)
    if (locationWarning) console.warn(locationWarning)
  }

  // Surface outbound-proxy config at startup so a user behind a proxy can
  // confirm UTA saw it — CCXT exchange instances are bridged onto it per
  // broker (see CcxtBroker.applyEnvProxy / issue #384). Credentials in the
  // URL (user:pass@) are redacted.
  const outboundProxy = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY || process.env.all_proxy
  if (outboundProxy) {
    console.log(`[uta] outbound proxy detected (${outboundProxy.replace(/\/\/[^@/]*@/, '//***@')}) — bridging into CCXT exchanges`)
  }

  const config = await loadConfig()

  // ==================== Trading-only dependencies ====================
  // UTA needs eventLog (UTAManager journaling) + toolCenter (CCXT tool
  // registration). Other infra Alice has (agentCenter, connectorCenter,
  // listenerRegistry, ...) is not used by trading routes.

  const eventLog = await createEventLog()
  const toolCenter = new ToolCenter()
  const utaManager = new UTAManager({ eventLog, toolCenter })

  // ==================== Account init (with ephemeral purge) ====================

  const survivors = await purgeEphemeralUTAs(await readUTAsConfig())
  const userIds = new Set(survivors.map((u) => u.id))
  const dataUTAs: UTAConfig[] = buildKeylessDataUTAs(config.trading.keylessDataSources, userIds)
  if (dataUTAs.length > 0) {
    console.log(`[uta] keyless data sources enabled: ${dataUTAs.map((u) => u.id).join(', ')}`)
  }

  for (const accCfg of [...dataUTAs, ...survivors]) {
    if (accCfg.enabled === false) continue
    // One account's init must never abort the whole bootstrap (broker
    // construction is sync; the connection is async + health-tracked, so this
    // only guards genuinely-broken config — but a built-in data UTA throwing
    // would otherwise take the user's real UTAs down with it).
    try {
      await utaManager.initUTA(accCfg)
    } catch (err) {
      console.warn(`[uta] failed to init "${accCfg.id}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  utaManager.registerCcxtToolsIfNeeded()

  // ==================== FX (single-asset-class slice of market-data) ====================
  // UTA needs only the currency client for USD conversion in
  // /api/trading/equity. The other market-data clients stay in Alice.

  const { providers } = config.marketData
  const executor = getSDKExecutor()
  const routeMap = buildRouteMap()
  const credentials = buildSDKCredentials(config.marketData.providerKeys)
  const currencyClient: CurrencyClientLike = new SDKCurrencyClient(executor, 'currency', providers.currency, credentials, routeMap)
  const fxService = new FxService(currencyClient, undefined, config.marketData.hub)
  utaManager.setFxService(fxService)

  // ==================== Snapshots ====================

  const snapshotService = createSnapshotService({ utaManager, eventLog })
  utaManager.setSnapshotHooks({
    onPostPush: (id) => { snapshotService.takeSnapshot(id, 'post-push') },
    onPostReject: (id) => { snapshotService.takeSnapshot(id, 'post-reject') },
  })

  const snapshotScheduler = createSnapshotScheduler({ snapshotService, config: config.snapshot })
  await snapshotScheduler.start()
  if (config.snapshot.enabled) {
    console.log(`[uta] snapshot scheduler started (every ${config.snapshot.every})`)
  }

  // ==================== Order-sync poller ====================
  // Fast lane (10s): fill/cancel detection for known pending orders —
  // broker calls only when something is actually pending. Slow lane
  // (config.trading.observeExternalOrdersEvery, default 15m): list open
  // orders to catch ones placed outside Alice.

  const observeRaw = config.trading.observeExternalOrdersEvery
  const observeIntervalMs = observeRaw === 'off' ? 0 : parseDuration(observeRaw)
  if (observeIntervalMs === null) {
    console.warn(`[uta] trading.json observeExternalOrdersEvery "${observeRaw}" is not a duration (e.g. "15m") — falling back to 15m`)
  }
  startOrderSyncPoller(() => utaManager.resolve(), { observeIntervalMs: observeIntervalMs ?? 15 * 60_000 })
  console.log(`[uta] order-sync poller started (10s pending lane; external-order observation ${observeRaw === 'off' ? 'off' : `every ${observeRaw}`})`)

  // ==================== Catalog refresh ====================
  // Brokers that cache catalog (Alpaca / CCXT / Mock) need periodic refresh.
  // No-op for brokers that query server-side. Lifted from src/main.ts:460-470.

  const catalogRefreshTimer = setInterval(() => {
    for (const uta of utaManager.resolve()) {
      uta.refreshCatalog().catch((err) => {
        console.warn(`[uta] catalog-refresh ${uta.id} failed:`, err instanceof Error ? err.message : err)
      })
    }
  }, CATALOG_REFRESH_MS)
  catalogRefreshTimer.unref?.()

  // ==================== Independent audit (A5, ADR-0010) ====================
  // Runs once at boot, then daily. No-ops per account when the RiskEngine
  // flag is off (nothing to cross-check yet) — see audit-runner.ts.

  const runAuditPass = (): void => {
    for (const uta of utaManager.resolve()) {
      runAuditAndEnforce(uta).catch((err) => {
        console.error(`[uta:audit] audit pass for "${uta.id}" threw unexpectedly:`, err instanceof Error ? err.message : err)
      })
    }
  }
  runAuditPass()
  const auditTimer = setInterval(runAuditPass, AUDIT_INTERVAL_MS)
  auditTimer.unref?.()

  // ==================== HTTP app ====================

  const app = new Hono()

  // Health probe — used by Guardian readiness gate and Alice BFF supervisor.
  app.get('/__uta/health', (c) => c.json({
    ok: true,
    startedAt,
    utas: utaManager.listUTAs().length,
  }))

  // Trading routes — UTA-side handlers, narrowly typed via UTAEngineContext.
  // Only utaManager / fxService / snapshotService are exposed because that's
  // all the route layer reads. See services/uta/src/types.ts and ANG-65 for
  // history (this used to be cast through Alice's EngineContext).
  const tradingCtx: UTAEngineContext = {
    utaManager,
    fxService,
    snapshotService,
  }
  // [PROPUESTA] Fase 4b — bearer-token auth (M7). No-op in compatibility
  // mode (no OPENALICE_UTA_TOKENS_FILE); see http/auth.ts.
  app.use('/api/trading/*', utaAuthMiddleware(utaTokensPath))
  app.use('/api/simulator/*', utaAuthMiddleware(utaTokensPath))
  app.use('/api/risk/*', utaAuthMiddleware(utaTokensPath))
  // [PROPUESTA] Fase 4d (S1) — after auth, so it can read c.get('utaAuth').
  // Only gates stage/commit on accounts the RO policy marks engineOwned.
  app.use('/api/trading/*', engineAccountGuard())

  app.route('/api/trading', createTradingRoutes(tradingCtx))
  // Simulator endpoints — MockBroker-only god-view operations the
  // /dev/simulator UI tab drives. Lives next to the trading routes
  // because both need direct access to UTA's in-process MockBroker
  // instances. Alice BFF proxies `/api/simulator/*` to here.
  app.route('/api/simulator', createSimulatorRoutes(tradingCtx))
  // [PROPUESTA] Hito 1 Parte 2 (AUDIT.md §18) — minimal kill-switch
  // GET/POST slice of the routes-risk.ts PROMPT_MASTER_CLAUDE_CODE.md §7
  // already specified. Falls back to 'operator' scope via auth.ts's
  // unmatched-route default — no new SCOPE_RULES entry needed.
  app.route('/api/risk', createRiskRoutes(tradingCtx))

  // ==================== Bind + shutdown ====================

  const bindHost = resolveUtaBindHost()
  const server = serve({
    fetch: app.fetch,
    port: UTA_PORT,
    hostname: bindHost,
  })
  console.log(`[uta] listening on http://${bindHost}:${UTA_PORT}`)

  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    console.log(`[uta] ${signal} → shutdown`)
    clearInterval(catalogRefreshTimer)
    clearInterval(auditTimer)
    snapshotScheduler.stop()
    server.close()
    await utaManager.closeAll().catch(() => { /* swallow during shutdown */ })
    await eventLog.close().catch(() => { /* swallow during shutdown */ })
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

if (!(globalThis as { __OPENALICE_INTERNAL_ROLE_DISPATCH__?: boolean }).__OPENALICE_INTERNAL_ROLE_DISPATCH__) {
  startUTAService().catch((err) => {
    console.error('[uta] fatal:', err)
    process.exit(1)
  })
}
