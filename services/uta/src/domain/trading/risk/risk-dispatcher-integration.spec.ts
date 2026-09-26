import { describe, expect, it, vi, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnifiedTradingAccount } from '../UnifiedTradingAccount.js'
import { MockBroker } from '../brokers/mock/index.js'
import { createTradingRoutes } from '../../../http/routes-trading.js'
import type { UTAEngineContext } from '../../../types.js'

/**
 * [PROPUESTA] Fase 4a — "las 4 rutas de escritura pasan por el RiskEngine":
 *
 *  A. Tool `tradingPush` (src/tool/trading.ts) and D. push vía Connector
 *     (src/services/connector-client/uta-review.ts:194) are HTTP CLIENTS —
 *     both call `UTAAccountSDK.push()` (src/services/uta-client/UTAAccountSDK.ts:290),
 *     which POSTs to `/api/trading/uta/:id/wallet/push` — verified by
 *     reading both files fresh in this session, not just carried over from
 *     Fase 0. Alice and UTA are separate OS processes communicating only
 *     over this HTTP surface (Fase 0), so there is no other path by which
 *     either could reach the broker. Proving route B below (the stage+
 *     commit+push flow driving the exact same `uta.push()` UTA-side
 *     method) is gated by RiskEngine therefore proves A and D are too.
 *
 *  B. HTTP `wallet/push` (stage → commit → push) — tested directly below.
 *  C. HTTP one-shot `wallet/place-order` — tested directly below.
 *
 * Both B and C ultimately call `UnifiedTradingAccount.push()` ->
 * `TradingGit.executePush()` -> `this.config.executeOperation(op)`, which
 * M1 wraps with `wrapDispatcherWithRiskEngine`. A single account, a policy
 * that rejects every action, and a spy on `broker.placeOrder` proves the
 * enforcement point is real: zero calls reach the broker.
 */

const REJECT_EVERYTHING_POLICY = {
  version: 1,
  accounts: { default: { allowedActions: [] as string[] } }, // R1 rejects every placeOrder/modifyOrder
}

function makeRoutes(accountId: string, uta: UnifiedTradingAccount) {
  const ctx = {
    utaManager: { get: (id: string) => (id === accountId ? uta : undefined) },
    snapshotService: undefined,
  } as unknown as UTAEngineContext
  return createTradingRoutes(ctx)
}

async function withPolicyFile(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'risk-dispatch-test-'))
  const path = join(dir, 'risk-policy.json')
  await writeFile(path, JSON.stringify(REJECT_EVERYTHING_POLICY))
  try {
    await fn(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const originalEnv = { ...process.env }
afterEach(() => {
  process.env = { ...originalEnv }
})

describe('RiskEngine wired into UnifiedTradingAccount (M1) — flag off is a no-op', () => {
  it('with the flag unset, an order that a strict policy WOULD reject still reaches the broker (unchanged pre-Fase-4a behavior)', async () => {
    delete process.env['OPENALICE_RISK_ENGINE_ENABLED']
    const accountId = `risk-dispatch-flagoff-${randomUUID()}`
    const broker = new MockBroker({ id: accountId })
    const placeSpy = vi.spyOn(broker, 'placeOrder')
    const uta = new UnifiedTradingAccount(broker)

    uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
    uta.commit('test')
    await uta.push(uta.status().pendingHash!)

    expect(placeSpy).toHaveBeenCalledTimes(1)
  })
})

describe('RiskEngine wired into UnifiedTradingAccount (M1) — 4 write paths, 0 broker calls when it rejects everything', () => {
  it('B. stage -> commit -> push (drives HTTP wallet/push server-side): 0 calls to broker.placeOrder', async () => {
    await withPolicyFile(async (policyPath) => {
      process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
      process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
      const accountId = `risk-dispatch-b-${randomUUID()}`
      const broker = new MockBroker({ id: accountId })
      const placeSpy = vi.spyOn(broker, 'placeOrder')
      const uta = new UnifiedTradingAccount(broker)

      uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
      uta.commit('test')
      const result = await uta.push(uta.status().pendingHash!)

      expect(placeSpy).not.toHaveBeenCalled()
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0]!.error).toContain('[risk:R1]')
    })
  })

  it('B (via the real HTTP route) — POST /uta/:id/wallet/push never reaches the broker', async () => {
    await withPolicyFile(async (policyPath) => {
      process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
      process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
      const accountId = `risk-dispatch-b-http-${randomUUID()}`
      const broker = new MockBroker({ id: accountId })
      const placeSpy = vi.spyOn(broker, 'placeOrder')
      const uta = new UnifiedTradingAccount(broker)
      const app = makeRoutes(accountId, uta)

      uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
      uta.commit('test')
      const pendingHash = uta.status().pendingHash!

      const res = await app.request(`/uta/${accountId}/wallet/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedPendingHash: pendingHash }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { rejected: Array<{ error: string }> }
      expect(body.rejected).toHaveLength(1)
      expect(body.rejected[0]!.error).toContain('[risk:R1]')
      expect(placeSpy).not.toHaveBeenCalled()
    })
  })

  it('C. HTTP one-shot POST /uta/:id/wallet/place-order never reaches the broker', async () => {
    await withPolicyFile(async (policyPath) => {
      process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
      process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
      const accountId = `risk-dispatch-c-http-${randomUUID()}`
      const broker = new MockBroker({ id: accountId })
      const placeSpy = vi.spyOn(broker, 'placeOrder')
      const uta = new UnifiedTradingAccount(broker)
      const app = makeRoutes(accountId, uta)

      const res = await app.request(`/uta/${accountId}/wallet/place-order`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'test one-shot',
          aliceId: `${accountId}|AAPL`,
          action: 'BUY',
          orderType: 'MKT',
          totalQuantity: '1',
        }),
      })
      const body = await res.json() as Record<string, unknown>
      expect(placeSpy).not.toHaveBeenCalled()
      // Whatever shape the one-shot route reports failure in, the broker must never have been called.
      expect(JSON.stringify(body)).toContain('risk:R1')
    })
  })
})
