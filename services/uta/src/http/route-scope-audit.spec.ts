/**
 * [PROPUESTA] Fase 4b corrección A.2 (2026-09-27) — default-deny audit.
 *
 * Enumerates every route ACTUALLY registered by `createTradingRoutes()`
 * and `createSimulatorRoutes()` (via Hono's own `app.routes`, not a
 * hand-maintained list that can silently drift from the real app) and
 * checks each one against an explicit expectation table. A route the
 * table doesn't know about fails the test — forcing whoever adds a new
 * route to make a conscious scope decision here, rather than silently
 * inheriting whatever `requiredScope()`'s fallback happens to be. A
 * write route (non-GET/HEAD) that resolves to `read` fails unless it is
 * on the explicit allowlist of pure market-data/account reads that
 * happen to carry a JSON body (documented in docs/uta-auth.md).
 *
 * `/__uta/health` is intentionally excluded — it is mounted on the
 * top-level app in main.ts BEFORE the auth middleware and is never
 * reachable through `/api/trading/*` or `/api/simulator/*`.
 */
import { describe, expect, it } from 'vitest'
import { createTradingRoutes } from './routes-trading.js'
import { createSimulatorRoutes } from './routes-simulator.js'
import { requiredScope } from './auth.js'
import { UTA_SCOPES, type UtaScope } from '../domain/trading/auth/types.js'
import type { UTAEngineContext } from '../types.js'

const fakeCtx = {
  utaManager: { get: () => undefined, resolve: () => [], listUTAs: () => [] },
  fxService: undefined,
  snapshotService: undefined,
} as unknown as UTAEngineContext

/**
 * The full, explicit contract: every route `createTradingRoutes()`
 * registers, keyed by `${METHOD} ${path}` (the sub-app-relative path,
 * exactly as Hono's `app.routes` reports it — main.ts mounts this at
 * `/api/trading`).
 */
const TRADING_EXPECTATIONS: Record<string, UtaScope> = {
  'GET /uta': 'read',
  'GET /equity': 'read',
  'GET /contracts/search': 'read',
  'GET /fx-rates': 'read',
  'POST /test-connection': 'operator',
  'POST /uta/:id/reconnect': 'operator',
  'POST /uta/:id/sync': 'operator',
  'POST /uta/:id/simulate-price': 'operator',
  'GET /uta/:id/subaccounts': 'read',
  'GET /uta/:id/account': 'read',
  'GET /uta/:id/positions': 'read',
  'GET /uta/:id/orders': 'read',
  'GET /uta/:id/market-clock': 'read',
  'GET /uta/:id/quote/:symbol': 'read',
  'POST /uta/:id/quote': 'read',
  'POST /uta/:id/contract/option-contracts': 'read',
  'POST /uta/:id/contract/option-chain': 'read',
  'POST /uta/:id/contract/order-book': 'read',
  'POST /uta/:id/contract/expand': 'read',
  'POST /uta/:id/historical': 'read',
  'POST /uta/:id/contracts/details': 'read',
  'GET /uta/:id/wallet/log': 'read',
  'GET /uta/:id/order-history': 'read',
  'GET /uta/:id/trade-history': 'read',
  'GET /uta/:id/wallet/show/:hash': 'read',
  'GET /uta/:id/wallet/status': 'read',
  'POST /uta/:id/wallet/commit': 'stage',
  'POST /uta/:id/wallet/reject': 'stage',
  'POST /uta/:id/wallet/push': 'approve',
  'POST /uta/:id/wallet/stage-place-order': 'stage',
  'POST /uta/:id/wallet/stage-modify-order': 'stage',
  'POST /uta/:id/wallet/stage-close-position': 'stage',
  'POST /uta/:id/wallet/stage-cancel-order': 'stage',
  'POST /uta/:id/wallet/place-order': 'approve',
  'POST /uta/:id/wallet/close-position': 'approve',
  'POST /uta/:id/wallet/cancel-order': 'approve',
  'GET /uta/:id/snapshots': 'read',
  'DELETE /uta/:id/snapshots/:timestamp': 'operator',
  'GET /snapshots/equity-curve': 'read',
}

/** Every route under `createSimulatorRoutes()` — all `simulator`, by
 *  construction of `requiredScope()`'s path-prefix rule, regardless of
 *  method. Listed explicitly (not just asserted as a blanket rule) so a
 *  newly added simulator route still has to appear here — the whole
 *  point of an enumeration test is that nothing gets to skip it. */
const SIMULATOR_ROUTE_COUNT_EXPECTED = 9

/** The only routes where a non-GET/HEAD method legitimately resolves to
 *  `read` — pure market-data/account lookups whose params happen to
 *  arrive as a JSON body. Anything outside this list that resolves to
 *  `read` on a write verb is a default-deny violation. */
const READ_SCOPED_WRITE_VERB_ALLOWLIST = new Set([
  'POST /uta/:id/quote',
  'POST /uta/:id/contract/option-contracts',
  'POST /uta/:id/contract/option-chain',
  'POST /uta/:id/contract/order-book',
  'POST /uta/:id/contract/expand',
  'POST /uta/:id/historical',
  'POST /uta/:id/contracts/details',
])

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

describe('route-scope-audit — every /api/trading/* route', () => {
  const app = createTradingRoutes(fakeCtx)
  const routes = app.routes.map((r) => ({ method: r.method, path: r.path }))

  it('registers exactly the routes this audit knows about (no silent additions)', () => {
    const seen = new Set(routes.map((r) => `${r.method} ${r.path}`))
    const expected = new Set(Object.keys(TRADING_EXPECTATIONS))
    const unexpected = [...seen].filter((k) => !expected.has(k))
    const missing = [...expected].filter((k) => !seen.has(k))
    expect(unexpected, 'new route(s) registered without a deliberate scope decision in this test').toEqual([])
    expect(missing, 'expectation table has stale entries for routes that no longer exist').toEqual([])
  })

  it.each(Object.entries(TRADING_EXPECTATIONS))('%s -> %s (matches requiredScope)', (key, expectedScope) => {
    const [method, ...pathParts] = key.split(' ')
    const path = pathParts.join(' ')
    expect(requiredScope(method, `/api/trading${path}`)).toBe(expectedScope)
  })

  it('never assigns `read` to a write-verb route outside the documented allowlist', () => {
    for (const [key, scope] of Object.entries(TRADING_EXPECTATIONS)) {
      const method = key.split(' ')[0]!
      if (!isReadMethod(method) && scope === 'read') {
        expect(READ_SCOPED_WRITE_VERB_ALLOWLIST.has(key), `${key} resolves to 'read' but is not allowlisted`).toBe(true)
      }
    }
  })

  it('every scope in the table is one of the fixed UTA_SCOPES', () => {
    for (const scope of Object.values(TRADING_EXPECTATIONS)) {
      expect(UTA_SCOPES).toContain(scope)
    }
  })
})

describe('route-scope-audit — every /api/simulator/* route', () => {
  const app = createSimulatorRoutes(fakeCtx)
  const routes = app.routes.map((r) => ({ method: r.method, path: r.path }))

  it('registers the expected number of routes (catches silent additions)', () => {
    expect(routes.length).toBe(SIMULATOR_ROUTE_COUNT_EXPECTED)
  })

  it('every route resolves to the `simulator` scope, regardless of method', () => {
    for (const r of routes) {
      expect(requiredScope(r.method, `/api/simulator${r.path}`), `${r.method} ${r.path}`).toBe('simulator')
    }
  })
})
