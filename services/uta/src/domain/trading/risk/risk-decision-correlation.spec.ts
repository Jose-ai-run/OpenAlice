import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataPath } from '@/core/paths.js'
import { UnifiedTradingAccount } from '../UnifiedTradingAccount.js'
import { MockBroker } from '../brokers/mock/index.js'
import type { RiskDecisionLogEntry } from './risk-log.js'

/**
 * [PROPUESTA] Fase 4c corrección item 4 (2026-09-27) — this is a
 * REQUIREMENT of A5 (ADR-0010), not a follow-up: the independent audit
 * job needs to join every executed TradingGit commit to its
 * risk-decisions.jsonl entry with zero ambiguity. This drives the real
 * `stage -> commit -> push` path (same as
 * risk-dispatcher-integration.spec.ts) and reads the actual log file
 * back, rather than asserting on `toLogEntry`'s return value in
 * isolation — the correlation only matters if it survives the real
 * `TradingGit.executePush()` -> `risk-dispatcher.ts` -> `risk-engine.ts`
 * chain end to end.
 */

const PERMISSIVE_POLICY = {
  version: 1,
  accounts: { default: { requireStopLoss: false, tradingHours: 'always' } },
}

async function withPolicyFile(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'risk-decision-correlation-'))
  const path = join(dir, 'risk-policy.json')
  await writeFile(path, JSON.stringify(PERMISSIVE_POLICY))
  try {
    await fn(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function readDecisions(accountId: string): Promise<RiskDecisionLogEntry[]> {
  const path = dataPath('trading', accountId, '_risk', 'risk-decisions.jsonl')
  const raw = await readFile(path, 'utf-8')
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as RiskDecisionLogEntry)
}

const originalEnv = { ...process.env }
function restoreEnv(): void { process.env = { ...originalEnv } }

describe('risk-decisions.jsonl carries an unambiguous commit correlation (Fase 4c item 4)', () => {
  it('a single placeOrder logs pendingHash === the real push commit hash, operationIndex 0, and no orderId (none exists yet)', async () => {
    await withPolicyFile(async (policyPath) => {
      process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
      process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
      try {
        const accountId = `risk-correlation-single-${randomUUID()}`
        const broker = new MockBroker({ id: accountId })
        const uta = new UnifiedTradingAccount(broker)

        uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
        uta.commit('test single')
        const pushResult = await uta.push(uta.status().pendingHash!)

        const decisions = await readDecisions(accountId)
        expect(decisions).toHaveLength(1)
        expect(decisions[0]!.pendingHash).toBe(pushResult.hash)
        expect(decisions[0]!.operationIndex).toBe(0)
        expect(decisions[0]!.orderId).toBeUndefined()
        expect(decisions[0]!.allowed).toBe(true)
      } finally {
        restoreEnv()
      }
    })
  })

  it('two operations staged into ONE commit share the same pendingHash but get distinct operationIndex values', async () => {
    await withPolicyFile(async (policyPath) => {
      process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
      process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
      try {
        const accountId = `risk-correlation-multi-${randomUUID()}`
        const broker = new MockBroker({ id: accountId })
        const uta = new UnifiedTradingAccount(broker)

        uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
        uta.stagePlaceOrder({ aliceId: `${accountId}|MSFT`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
        uta.commit('test multi')
        const pushResult = await uta.push(uta.status().pendingHash!)

        const decisions = await readDecisions(accountId)
        expect(decisions).toHaveLength(2)
        expect(decisions[0]!.pendingHash).toBe(pushResult.hash)
        expect(decisions[1]!.pendingHash).toBe(pushResult.hash)
        expect([decisions[0]!.operationIndex, decisions[1]!.operationIndex].sort()).toEqual([0, 1])
      } finally {
        restoreEnv()
      }
    })
  })

  it('a modifyOrder logs the real orderId (a genuine pre-existing correlation field, unlike placeOrder)', async () => {
    await withPolicyFile(async (policyPath) => {
      process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
      process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
      try {
        const accountId = `risk-correlation-modify-${randomUUID()}`
        const broker = new MockBroker({ id: accountId })
        const uta = new UnifiedTradingAccount(broker)

        // A limit order far below market stays pending in MockBroker (a
        // market order fills immediately, leaving nothing to modify).
        uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'LMT', lmtPrice: '1', totalQuantity: '1' })
        uta.commit('place')
        await uta.push(uta.status().pendingHash!)

        const pendingIds = uta.getPendingOrderIds().map((p) => p.orderId)
        expect(pendingIds.length).toBeGreaterThan(0)
        const orderId = pendingIds[0]!

        uta.stageModifyOrder({ orderId, totalQuantity: '2' })
        uta.commit('modify')
        await uta.push(uta.status().pendingHash!)

        const decisions = await readDecisions(accountId)
        const modifyDecision = decisions.find((d) => d.operationAction === 'modifyOrder')
        expect(modifyDecision?.orderId).toBe(orderId)
      } finally {
        restoreEnv()
      }
    })
  })

  it('a rejected operation (never reaches the broker) still logs a correlation to the commit that recorded the rejection', async () => {
    const REJECT_POLICY = { version: 1, accounts: { default: { allowedActions: [] as string[] } } }
    const dir = await mkdtemp(join(tmpdir(), 'risk-decision-correlation-reject-'))
    const policyPath = join(dir, 'risk-policy.json')
    await writeFile(policyPath, JSON.stringify(REJECT_POLICY))
    process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
    process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
    try {
      const accountId = `risk-correlation-reject-${randomUUID()}`
      const broker = new MockBroker({ id: accountId })
      const uta = new UnifiedTradingAccount(broker)

      uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
      uta.commit('test rejected')
      const pushResult = await uta.push(uta.status().pendingHash!)
      expect(pushResult.rejected).toHaveLength(1)

      const decisions = await readDecisions(accountId)
      expect(decisions).toHaveLength(1)
      expect(decisions[0]!.allowed).toBe(false)
      expect(decisions[0]!.pendingHash).toBe(pushResult.hash)
      expect(decisions[0]!.operationIndex).toBe(0)
    } finally {
      restoreEnv()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
