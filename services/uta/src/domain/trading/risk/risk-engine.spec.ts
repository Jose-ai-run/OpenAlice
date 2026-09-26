import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import { Order } from '@traderalice/ibkr'
import { evaluateRisk } from './risk-engine.js'
import { loadRiskState, saveRiskState, currentDayKey } from './risk-state.js'
import { MockBroker, makeContract } from '../brokers/mock/index.js'
import { makePlaceOrder, makeModifyOrder } from './test-fixtures.js'

function uniqueAccountId(): string {
  return `risk-engine-test-${randomUUID()}`
}

async function withPolicyFile(policy: unknown, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'risk-engine-test-'))
  const path = join(dir, 'risk-policy.json')
  await writeFile(path, JSON.stringify(policy))
  try {
    await fn(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const PERMISSIVE_POLICY = {
  version: 1,
  accounts: { default: { requireStopLoss: false, tradingHours: 'always' } },
}

describe('evaluateRisk — fail-closed', () => {
  it('rejects with HALT_NEW when the policy file does not exist', async () => {
    const accountId = uniqueAccountId()
    const verdict = await evaluateRisk(makePlaceOrder(), {
      broker: new MockBroker(), accountId, policyPath: '/definitely/does/not/exist/risk-policy.json',
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.killSwitch).toBe('HALT_NEW')
  })

  it('rejects with HALT_NEW when the policy file is invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'risk-engine-test-'))
    const path = join(dir, 'risk-policy.json')
    await writeFile(path, '{ not valid json')
    try {
      const verdict = await evaluateRisk(makePlaceOrder(), { broker: new MockBroker(), accountId: uniqueAccountId(), policyPath: path })
      expect(verdict.allowed).toBe(false)
      expect(verdict.killSwitch).toBe('HALT_NEW')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects with HALT_NEW when the account has no policy entry (and no "default")', async () => {
    await withPolicyFile({ version: 1, accounts: { 'some-other-account': {} } }, async (path) => {
      const verdict = await evaluateRisk(makePlaceOrder(), { broker: new MockBroker(), accountId: uniqueAccountId(), policyPath: path })
      expect(verdict.allowed).toBe(false)
      expect(verdict.killSwitch).toBe('HALT_NEW')
    })
  })

  it('rejects with HALT_NEW when the persistent risk state is corrupt', async () => {
    await withPolicyFile(PERMISSIVE_POLICY, async (path) => {
      const accountId = uniqueAccountId()
      const now = new Date('2026-09-25T12:00:00.000Z')
      // Write garbage directly where risk-state.json lives for this account.
      const stateDir = join(process.env['OPENALICE_HOME']!, 'data', 'trading', accountId, '_risk')
      await mkdir(stateDir, { recursive: true })
      await writeFile(join(stateDir, 'risk-state.json'), 'not json at all { [ }')

      const verdict = await evaluateRisk(makePlaceOrder(), { broker: new MockBroker(), accountId, policyPath: path, now: () => now })
      expect(verdict.allowed).toBe(false)
      expect(verdict.killSwitch).toBe('HALT_NEW')
    })
  })

  it('allows a compliant order against a permissive policy (sanity check the happy path exists)', async () => {
    await withPolicyFile(PERMISSIVE_POLICY, async (path) => {
      const verdict = await evaluateRisk(makePlaceOrder({ stopLossPrice: 90 }), { broker: new MockBroker(), accountId: uniqueAccountId(), policyPath: path })
      expect(verdict.allowed).toBe(true)
    })
  })
})

describe('evaluateRisk — consecutive rejects trip the kill switch', () => {
  it('after maxConsecutiveRejects rejections, R19 fires and sets HALT_NEW', async () => {
    const policy = { version: 1, accounts: { default: { requireStopLoss: true, tradingHours: 'always', maxConsecutiveRejects: 2 } } }
    await withPolicyFile(policy, async (path) => {
      const accountId = uniqueAccountId()
      const broker = new MockBroker()
      // No stop attached -> R14 rejects every time (deliberately, to accumulate rejects). R14 sits
      // earlier in RULE_CHAIN than R19, so it's the one that fires here — that's expected.
      const v1 = await evaluateRisk(makePlaceOrder(), { broker, accountId, policyPath: path })
      expect(v1.ruleCode).toBe('R14')
      const v2 = await evaluateRisk(makePlaceOrder(), { broker, accountId, policyPath: path })
      expect(v2.ruleCode).toBe('R14')
      // Third attempt is otherwise fully compliant (has a stop, passes R0-R18) — the ONLY reason
      // it's rejected is R19 reading consecutiveRejects=2 from the two R14 rejections above.
      const v3 = await evaluateRisk(makePlaceOrder({ stopLossPrice: 90 }), { broker, accountId, policyPath: path })
      expect(v3.ruleCode).toBe('R19')
      expect(v3.killSwitch).toBe('HALT_NEW')
    })
  })
})

describe('evaluateRisk — kill switch persists across a simulated restart', () => {
  it('a HALT_NEW from R16 blocks a brand-new evaluateRisk call with no shared state', async () => {
    const policy = { version: 1, accounts: { default: { requireStopLoss: false, tradingHours: 'always', maxDailyLossPctEquity: 5 } } }
    await withPolicyFile(policy, async (path) => {
      const accountId = uniqueAccountId()
      const now = new Date('2026-09-25T12:00:00.000Z')

      // Seed a prior day's start equity of 10000; the account is funded at 9000 (10% loss).
      await saveRiskState(accountId, { ...(await loadRiskState(accountId, currentDayKey(now))), dailyStartEquity: '10000' })

      const verdict = await evaluateRisk(makePlaceOrder(), { broker: new MockBroker({ cash: 9000 }), accountId, policyPath: path, now: () => now })
      expect(verdict.allowed).toBe(false)
      expect(verdict.ruleCode).toBe('R16')
      expect(verdict.killSwitch).toBe('HALT_NEW')

      // "Restart": a completely independent evaluateRisk call, same accountId,
      // no object/reference carried over — the only way it can know about
      // the halt is by reading it back from disk.
      const afterRestart = await evaluateRisk(makePlaceOrder(), { broker: new MockBroker({ cash: 9000 }), accountId, policyPath: path, now: () => now })
      expect(afterRestart.allowed).toBe(false)
      expect(afterRestart.killSwitch).toBe('HALT_NEW')
      expect(afterRestart.ruleCode).toBe('R0') // R0 (kill switch) now fires first
    })
  })
})

describe('evaluateRisk — modifyOrder enlarging a position is rejected (R18)', () => {
  it('rejects a modify that increases the order quantity', async () => {
    await withPolicyFile(PERMISSIVE_POLICY, async (path) => {
      const accountId = uniqueAccountId()
      const broker = new MockBroker()
      const contract = makeContract()
      const order = new Order()
      order.action = 'BUY'
      order.orderType = 'LMT'
      order.lmtPrice = new Decimal(100)
      order.totalQuantity = new Decimal(10)
      const placed = await broker.placeOrder(contract, order)
      const orderId = placed.orderId!

      const verdict = await evaluateRisk(makeModifyOrder({ orderId, totalQuantity: 100 }), { broker, accountId, policyPath: path })
      expect(verdict.allowed).toBe(false)
      expect(verdict.ruleCode).toBe('R18')
    })
  })
})
