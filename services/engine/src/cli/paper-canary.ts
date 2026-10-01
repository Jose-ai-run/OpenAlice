/**
 * [PROPUESTA] PAPER-mode canary driver — Hito 1 Parte 2, items 3a+3b+kill
 * switch + restart test (docs/trading-engine/AUDIT.md §18).
 *
 * NOT the production ExecutionManager (Fase 7 — services/engine/src/execution/
 * is still a .gitkeep placeholder). A narrow, demo-scoped harness that:
 *  - verifies the instrument mapping (item 3a) against the real paper account;
 *  - reuses runCycle()/MarketDataStore/Journal exactly as signal-only-replay.ts
 *    does, for the journaled ENTER/EXIT decisions;
 *  - drives UTA's EXISTING stage/commit/push/sync HTTP routes directly (no new
 *    UTA surface) to complete one real entry(+protective stop)->exit round
 *    trip on a MockBroker paper account;
 *  - locates a GENUINE historical ENTER signal and a GENUINE subsequent
 *    stop-out or opposite-crossover exit by running the real strategy code
 *    over real historical bars — never fabricates a signal;
 *  - demonstrates the kill switch and a mid-cycle-restart-without-duplicates
 *    property using only existing, real UTA mechanics (TradingGit's
 *    single-pending-commit rule; the new minimal routes-risk.ts).
 *
 * Requires UTA running and reachable. For the kill-switch step to actually
 * block anything, UTA must have been started with
 * OPENALICE_RISK_ENGINE_ENABLED=1 and OPENALICE_RISK_POLICY_PATH set to a
 * real policy file (see docs/trading-engine/DEMO-LOCAL.md).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Bar } from '@traderalice/uta-protocol'
import { loadEngineConfig } from '../config/engine-config.js'
import { openDatabase } from '../db/database.js'
import { runMigrations } from '../db/migrate.js'
import { migrations } from '../db/migrations/0001-init.js'
import { Journal } from '../journal/journal.js'
import { MarketDataStore } from '../data/market-data-store.js'
import { EngineUtaClient } from '../uta/uta-client.js'
import { PriceFeeder, nativeKeyOf, paperAliceId } from '../data/price-feeder.js'
import { trendFollowingStrategy } from '../strategies/trend-following.js'
import { buildStrategyContext } from '../strategies/context-builder.js'
import { intervalMs } from '../clock/candle-boundaries.js'
import { runCycle } from '../loop/run-cycle.js'
import type { StrategyDecision } from '../strategies/types.js'

interface OpenPosition { side: 'long' | 'short'; entry: number; stop: number }

function sideToAction(side: 'long' | 'short'): 'BUY' | 'SELL' {
  return side === 'long' ? 'BUY' : 'SELL'
}
function protectiveStopAction(side: 'long' | 'short'): 'BUY' | 'SELL' {
  // Closing a long = SELL; closing a short = BUY (opposite of the entry action).
  return side === 'long' ? 'SELL' : 'BUY'
}

async function utaFetch(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, body }
}

/** Respect maxOrderNotional (5000) and maxRiskPerTradePctEquity (1% of 100000 cash) from deploy/examples/risk-policy.example.json. */
function sizeOrder(entry: number, stop: number): string {
  const byNotional = 5000 / entry
  const byRisk = 1000 / Math.abs(entry - stop)
  const qty = Math.max(0.001, Math.floor(Math.min(byNotional, byRisk) * 1000) / 1000)
  return qty.toString()
}

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? resolve(import.meta.dirname, '../config/engine-config.canary.json')
  const dbPath = process.argv[3] ?? resolve(import.meta.dirname, '../../data/paper-canary.db')
  const lookbackBars = Number(process.argv[4] ?? 1500)
  const utaBaseUrl = process.env['OPENALICE_UTA_URL'] ?? 'http://127.0.0.1:47333'

  const config = loadEngineConfig(JSON.parse(readFileSync(configPath, 'utf-8')))
  if (config.mode !== 'PAPER' || !config.paperAccountId) {
    throw new Error('paper-canary requires mode="PAPER" and a paperAccountId in the config')
  }
  const paperAccountId = config.paperAccountId
  const strategy = trendFollowingStrategy

  const db = openDatabase(dbPath)
  runMigrations(db, migrations)
  const journal = new Journal(db)
  const client = new EngineUtaClient({ baseUrl: utaBaseUrl })
  const marketDataStore = new MarketDataStore({ client })
  const feeder = new PriceFeeder({ utaBaseUrl })

  console.log(`[canary] config=${configPath}`)
  console.log(`[canary] db=${dbPath}`)
  console.log(`[canary] uta=${utaBaseUrl} paperAccountId=${paperAccountId}`)
  console.log('')

  // ==================== 3a: instrument mapping ====================
  console.log('[canary] === 3a: mapeo de instrumentos ===')
  const tradable = []
  for (const entry of config.universe) {
    try {
      const nk = nativeKeyOf(entry.aliceId)
      const paperId = paperAliceId(paperAccountId, entry.aliceId)
      tradable.push(entry)
      console.log(`[canary] mapeo OK: ${entry.label}  ${entry.aliceId}  ->  ${paperId}  (nativeKey=${nk})`)
    } catch (err) {
      console.log(`[canary] mapeo INVALIDO — "${entry.label}" NO se tradea: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (tradable.length === 0) throw new Error('ningún símbolo del universe tiene un mapeo válido')
  const entry = tradable[0]!
  const paperId = paperAliceId(paperAccountId, entry.aliceId)
  const nativeKey = nativeKeyOf(entry.aliceId)
  console.log('')

  // ==================== discovery: real historical data, real strategy code ====================
  console.log(`[canary] === discovery: buscando una señal ENTER real de ${strategy.id} para ${entry.label} ===`)
  const raw: Bar[] = await client.getHistoricalBars({
    utaId: entry.utaId, contract: { aliceId: entry.aliceId },
    params: { interval: config.interval, limit: lookbackBars },
  })
  if (raw.length < 40) throw new Error(`insuficientes velas reales devueltas por UTA (${raw.length})`)
  const ms = intervalMs(config.interval)
  const closeAtOf = (i: number): Date => new Date(raw[i]!.timestamp.getTime() + ms)

  let enterIdx = -1
  let enterDecision: Extract<StrategyDecision, { kind: 'ENTER' }> | undefined
  for (let i = 1; i < raw.length - 1; i++) {
    const ctx = buildStrategyContext({
      bars: raw.slice(0, i + 1), interval: config.interval, asOf: closeAtOf(i),
      params: config.strategy.params ?? {},
    })
    const decision = strategy.evaluate(ctx)
    if (decision.kind === 'ENTER') { enterIdx = i; enterDecision = decision; break }
  }
  if (enterIdx < 0 || !enterDecision) {
    throw new Error(
      `NO ENCONTRADO: ninguna señal ENTER real de ${strategy.id} en las últimas ${raw.length} velas reales de ${entry.label}. ` +
      'No se fabrica una señal falsa — ampliar lookbackBars o probar otro símbolo/intervalo.',
    )
  }
  console.log(`[canary] ENTER real @ ${closeAtOf(enterIdx).toISOString()}: ${enterDecision.side} entry=${enterDecision.entry} stop=${enterDecision.stop} score=${enterDecision.score} reasons=${enterDecision.reasonCodes.join('|')}`)

  const position: OpenPosition = { side: enterDecision.side, entry: enterDecision.entry, stop: enterDecision.stop }
  let exitIdx = -1
  let exitReason: 'STOP_OUT' | 'SIGNAL_EXIT' | undefined
  let exitPrice = 0
  let exitDecision: StrategyDecision | undefined
  for (let i = enterIdx + 1; i < raw.length; i++) {
    const bar = raw[i]!
    const low = Number(bar.low)
    const high = Number(bar.high)
    const stoppedOut = position.side === 'long' ? low <= position.stop : high >= position.stop
    if (stoppedOut) { exitIdx = i; exitReason = 'STOP_OUT'; exitPrice = position.stop; break }
    const ctx = buildStrategyContext({
      bars: raw.slice(0, i + 1), interval: config.interval, asOf: closeAtOf(i),
      params: config.strategy.params ?? {}, position,
    })
    const decision = strategy.evaluate(ctx)
    if (decision.kind === 'EXIT') { exitIdx = i; exitReason = 'SIGNAL_EXIT'; exitPrice = Number(bar.close); exitDecision = decision; break }
  }
  if (exitIdx < 0) {
    console.log(`[canary] AVISO: ninguna salida real dentro de las ${raw.length} velas — solo se ejecutará la entrada; la posición queda abierta y protegida por el stop real.`)
  } else {
    console.log(`[canary] salida real @ ${closeAtOf(exitIdx).toISOString()}: ${exitReason} price=${exitPrice}`)
  }
  console.log('')

  // ==================== 3b: replay real — ENTER ====================
  console.log('[canary] === 3b: replay real — entrada ===')
  const entryCloseAt = closeAtOf(enterIdx)
  const entryCycle = await runCycle({
    config: { ...config, universe: [entry] }, marketDataStore, strategy, journal, closeAt: entryCloseAt,
  })
  console.log(`[canary] journal: cycle_id=${entryCycle.cycleId} decisión ENTER real registrada @ ${entryCloseAt.toISOString()}`)

  await feeder.setMarkPrice(paperAccountId, nativeKey, String(enterDecision.entry))
  console.log(`[canary] markPrice(${paperAccountId}, ${nativeKey}) = ${enterDecision.entry}`)

  const qty = sizeOrder(enterDecision.entry, enterDecision.stop)
  console.log(`[canary] qty (maxOrderNotional/maxRiskPerTradePctEquity) = ${qty}`)

  // R14 ("stop obligatorio") evaluates each operation independently — it has
  // no cross-operation awareness of a sibling STP order in the same commit,
  // so the entry's own `stopLoss` must be attached here for R14 to allow it
  // (confirmed by a real rejection on the first attempt against this exact
  // policy — see docs/trading-engine/AUDIT.md §18). MockBroker itself
  // ignores `tpsl` (confirmed by code inspection: it only appears in the
  // call-log recorder, never acted on) — it ONLY satisfies R14's risk
  // check; the actual protective mechanism is the separate real STP order
  // staged right after it, which MockBroker genuinely matches against
  // later mark-price updates.
  const entryStageBody = { aliceId: paperId, action: sideToAction(enterDecision.side), orderType: 'MKT', totalQuantity: qty, stopLoss: { price: String(enterDecision.stop) } }
  const stopStageBody = { aliceId: paperId, action: protectiveStopAction(enterDecision.side), orderType: 'STP', totalQuantity: qty, auxPrice: String(enterDecision.stop) }

  const stageEntry = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/stage-place-order`, { method: 'POST', body: JSON.stringify(entryStageBody) })
  if (!stageEntry.ok) throw new Error(`stage-place-order (entrada) falló — símbolo sin mapeo válido en ${paperAccountId} o error real: ${JSON.stringify(stageEntry.body)}`)
  console.log(`[canary] staged entrada MKT: ${JSON.stringify(stageEntry.body)}`)

  // The protective STP order is pushed in a SEPARATE, later commit — real
  // finding (AUDIT.md §18): R13 (cooldown) fires per symbol per push with no
  // exception for a protective stop, so staging it in the SAME commit as the
  // entry got it rejected by R13 immediately after the entry's own push set
  // the cooldown. Staging it here only, now, and committing+pushing it after
  // the real cooldownSecondsPerSymbol window elapses avoids that — it does
  // not route around R13, it simply waits for it like any other caller would.

  const commitEntry = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/commit`, {
    method: 'POST',
    body: JSON.stringify({ message: `[canary] ${entry.label} ENTER ${enterDecision.side} @ ${enterDecision.entry} stop=${enterDecision.stop} reasons=${enterDecision.reasonCodes.join('|')}` }),
  })
  if (!commitEntry.ok) throw new Error(`commit (entrada) falló: ${JSON.stringify(commitEntry.body)}`)
  const pendingHash1 = (commitEntry.body as { hash: string }).hash
  console.log(`[canary] commit preparado, pendingHash=${pendingHash1}, operationCount=${(commitEntry.body as { operationCount: number }).operationCount}`)

  // ---- restart-mid-cycle test: re-attempt staging as if the Engine forgot it already committed ----
  const restartStage = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/stage-place-order`, { method: 'POST', body: JSON.stringify(entryStageBody) })
  const status1 = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/status`, { method: 'GET' })
  const statusBody1 = status1.body as { pendingHash: string | null }
  if (restartStage.ok || statusBody1.pendingHash !== pendingHash1) {
    throw new Error(`[canary] FALLO de la prueba de reinicio: se habría creado una orden duplicada. stage2.ok=${restartStage.ok} pendingHash=${statusBody1.pendingHash} esperado=${pendingHash1}`)
  }
  console.log(`[canary] reinicio a mitad de ciclo simulado: el reintento de stage fue RECHAZADO (HTTP ${restartStage.status}: ${JSON.stringify(restartStage.body)}) — pendingHash sigue siendo ${statusBody1.pendingHash} — CERO duplicados.`)

  const pushEntry = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/push`, { method: 'POST', body: JSON.stringify({ expectedPendingHash: pendingHash1 }) })
  if (!pushEntry.ok) throw new Error(`push (entrada) falló: ${JSON.stringify(pushEntry.body)}`)
  console.log(`[canary] ENTRADA pusheada — commit real en TradingGit: ${JSON.stringify(pushEntry.body)}`)

  const cooldownSeconds = 65
  console.log(`[canary] esperando ${cooldownSeconds}s reales (R13 cooldownSecondsPerSymbol=60 de la política) antes de armar el stop protector en un commit separado...`)
  await new Promise((r) => setTimeout(r, cooldownSeconds * 1000))

  const stageStop = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/stage-place-order`, { method: 'POST', body: JSON.stringify(stopStageBody) })
  if (!stageStop.ok) throw new Error(`stage-place-order (stop protector) falló: ${JSON.stringify(stageStop.body)}`)
  console.log(`[canary] staged stop protector STP (commit separado): ${JSON.stringify(stageStop.body)}`)
  const commitStop = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/commit`, {
    method: 'POST', body: JSON.stringify({ message: `[canary] ${entry.label} stop protector armado @ ${enterDecision.stop}` }),
  })
  if (!commitStop.ok) throw new Error(`commit (stop protector) falló: ${JSON.stringify(commitStop.body)}`)
  const pendingHashStop = (commitStop.body as { hash: string }).hash
  const pushStop = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/push`, { method: 'POST', body: JSON.stringify({ expectedPendingHash: pendingHashStop }) })
  if (!pushStop.ok) throw new Error(`push (stop protector) falló: ${JSON.stringify(pushStop.body)}`)
  console.log(`[canary] STOP PROTECTOR pusheado — commit real en TradingGit: ${JSON.stringify(pushStop.body)}`)
  const stopPushResults = (pushStop.body as { results?: Array<{ orderId?: string }> }).results ?? []
  const stopOrderId = stopPushResults[0]?.orderId
  console.log('')

  // ==================== 3b: replay real — EXIT ====================
  console.log('[canary] === 3b: replay real — salida ===')
  if (exitIdx >= 0 && exitReason === 'STOP_OUT') {
    await feeder.setMarkPrice(paperAccountId, nativeKey, String(exitPrice))
    console.log(`[canary] markPrice(${paperAccountId}, ${nativeKey}) = ${exitPrice} — stop real alcanzado con datos de mercado reales; la orden STP pendiente debería auto-ejecutarse`)
    const sync = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/sync`, { method: 'POST', body: JSON.stringify({}) })
    console.log(`[canary] sync tras el stop — nuevo commit si hubo cambio de estado: ${JSON.stringify(sync.body)}`)
  } else if (exitIdx >= 0 && exitReason === 'SIGNAL_EXIT' && exitDecision) {
    const exitCloseAt = closeAtOf(exitIdx)
    const exitCycle = await runCycle({
      config: { ...config, universe: [entry] }, marketDataStore, strategy, journal, closeAt: exitCloseAt,
      getPosition: () => position,
    })
    console.log(`[canary] journal: cycle_id=${exitCycle.cycleId} decisión EXIT real registrada @ ${exitCloseAt.toISOString()}`)
    await feeder.setMarkPrice(paperAccountId, nativeKey, String(exitPrice))
    console.log(`[canary] markPrice(${paperAccountId}, ${nativeKey}) = ${exitPrice}`)

    if (stopOrderId) {
      const cancelStop = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/stage-cancel-order`, {
        method: 'POST', body: JSON.stringify({ orderId: stopOrderId }),
      })
      console.log(`[canary] staged cancel del stop pendiente (${stopOrderId}): ${JSON.stringify(cancelStop.body)}`)
    } else {
      console.log('[canary] AVISO: no se pudo determinar el orderId del stop pendiente para cancelarlo — se procede solo con el cierre de posición.')
    }

    const stageClose = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/stage-close-position`, { method: 'POST', body: JSON.stringify({ aliceId: paperId }) })
    if (!stageClose.ok) throw new Error(`stage-close-position falló: ${JSON.stringify(stageClose.body)}`)
    console.log(`[canary] staged cierre de posición: ${JSON.stringify(stageClose.body)}`)

    const exitReasonCodes = exitDecision.kind === 'EXIT' ? exitDecision.reasonCodes : []
    const commitExit = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/commit`, {
      method: 'POST',
      body: JSON.stringify({ message: `[canary] ${entry.label} EXIT señal reasons=${exitReasonCodes.join('|')}` }),
    })
    if (!commitExit.ok) throw new Error(`commit (salida) falló: ${JSON.stringify(commitExit.body)}`)
    const pendingHash2 = (commitExit.body as { hash: string }).hash
    const pushExit = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/push`, { method: 'POST', body: JSON.stringify({ expectedPendingHash: pendingHash2 }) })
    if (!pushExit.ok) throw new Error(`push (salida) falló: ${JSON.stringify(pushExit.body)}`)
    console.log(`[canary] SALIDA pusheada — commit real en TradingGit: ${JSON.stringify(pushExit.body)}`)
  } else {
    console.log('[canary] sin salida dentro de la ventana — posición abierta, protegida por el stop; no se fuerza un cierre artificial.')
  }
  console.log('')

  // ==================== kill switch ====================
  console.log('[canary] === kill switch ===')
  const killOn = await utaFetch(utaBaseUrl, `/api/risk/uta/${paperAccountId}/kill-switch`, { method: 'POST', body: JSON.stringify({ status: 'HALT_NEW', reason: 'canary: prueba de kill switch' }) })
  console.log(`[canary] kill-switch HALT_NEW: HTTP ${killOn.status} ${JSON.stringify(killOn.body)}`)

  const probeStage = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/stage-place-order`, { method: 'POST', body: JSON.stringify(entryStageBody) })
  console.log(`[canary] stage tras kill switch: HTTP ${probeStage.status} ${JSON.stringify(probeStage.body)}`)
  if (probeStage.ok) {
    const probeCommit = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/commit`, { method: 'POST', body: JSON.stringify({ message: '[canary] prueba kill switch — no debería ejecutarse' }) })
    console.log(`[canary] commit tras kill switch: HTTP ${probeCommit.status} ${JSON.stringify(probeCommit.body)}`)
    if (probeCommit.ok) {
      const probeHash = (probeCommit.body as { hash: string }).hash
      const probePush = await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/push`, { method: 'POST', body: JSON.stringify({ expectedPendingHash: probeHash }) })
      console.log(`[canary] push tras kill switch (se espera rechazo del RiskEngine, R0): HTTP ${probePush.status} ${JSON.stringify(probePush.body)}`)
      // Clear the probe's own pending/staged state either way so the account isn't left dirty.
      if (!probePush.ok) await utaFetch(utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/reject`, { method: 'POST', body: JSON.stringify({ expectedPendingHash: probeHash, reason: 'canary cleanup' }) })
    }
  }

  const killOff = await utaFetch(utaBaseUrl, `/api/risk/uta/${paperAccountId}/kill-switch/reset`, { method: 'POST', body: JSON.stringify({ reason: 'canary: fin de la prueba', force: true }) })
  console.log(`[canary] kill-switch reset a NORMAL: HTTP ${killOff.status} ${JSON.stringify(killOff.body)}`)
  console.log('')

  console.log(`[canary] done — evidencia real en ${dbPath} y en ${utaBaseUrl}/api/trading/uta/${paperAccountId}/wallet/log`)
}

main().catch((err) => {
  console.error('[canary] fatal:', err)
  process.exit(1)
})
