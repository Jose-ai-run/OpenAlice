import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Isolated from risk-engine.spec.ts on purpose: `vi.mock` here replaces
 * `saveRiskState` for every test in THIS file's module graph, so a
 * definitive, real (not simulated-by-filesystem-sabotage) write failure
 * can be produced without a broken read path also (wrongly) tripping the
 * separate "corrupt state" fail-closed case already covered elsewhere.
 */
const SABOTAGED_ACCOUNT_ID = 'risk-engine-write-failure-target'

vi.mock('./risk-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./risk-state.js')>()
  return {
    ...actual,
    saveRiskState: vi.fn(async (accountId: string, state: Parameters<typeof actual.saveRiskState>[1]) => {
      if (accountId === SABOTAGED_ACCOUNT_ID) {
        throw Object.assign(new Error('simulated definitive disk failure (as if all EPERM/EBUSY retries were exhausted)'), { code: 'EIO' })
      }
      return actual.saveRiskState(accountId, state)
    }),
  }
})

import { evaluateRisk } from './risk-engine.js'
import { MockBroker } from '../brokers/mock/index.js'
import { makePlaceOrder } from './test-fixtures.js'

const PERMISSIVE_POLICY = {
  version: 1,
  accounts: { default: { requireStopLoss: false, tradingHours: 'always' } },
}

async function withPolicyFile(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'risk-engine-write-failure-'))
  const path = join(dir, 'risk-policy.json')
  await writeFile(path, JSON.stringify(PERMISSIVE_POLICY))
  try {
    await fn(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('evaluateRisk — fail-closed on a definitive state-write failure', () => {
  it('forces HALT_NEW and reports STATE_WRITE_FAILURE instead of returning the rule chain\'s real (allow) verdict', async () => {
    await withPolicyFile(async (path) => {
      // A compliant order the rule chain would otherwise ALLOW — proves the
      // forced rejection comes from the write failure, not from any rule.
      const verdict = await evaluateRisk(makePlaceOrder({ stopLossPrice: 90 }), {
        broker: new MockBroker(), accountId: SABOTAGED_ACCOUNT_ID, policyPath: path,
      })
      expect(verdict.allowed).toBe(false)
      expect(verdict.ruleCode).toBe('STATE_WRITE_FAILURE')
      expect(verdict.killSwitch).toBe('HALT_NEW')
      expect(verdict.reason).toContain('risk state write failed definitively')
    })
  })

  it('also forces HALT_NEW when the write fails on a rule REJECTION path (not just the allow path)', async () => {
    await withPolicyFile(async (path) => {
      // No stop attached -> R14 would normally just reject with R14; the
      // write failure must still force STATE_WRITE_FAILURE/HALT_NEW instead
      // of silently returning "R14 rejected" while consecutiveRejects never
      // actually got persisted.
      const verdict = await evaluateRisk(makePlaceOrder(), {
        broker: new MockBroker(), accountId: SABOTAGED_ACCOUNT_ID, policyPath: path,
      })
      expect(verdict.allowed).toBe(false)
      expect(verdict.ruleCode).toBe('STATE_WRITE_FAILURE')
      expect(verdict.killSwitch).toBe('HALT_NEW')
    })
  })

  it('an unrelated account (not sabotaged) is unaffected — the mock passes through to the real implementation', async () => {
    await withPolicyFile(async (path) => {
      const verdict = await evaluateRisk(makePlaceOrder({ stopLossPrice: 90 }), {
        broker: new MockBroker(), accountId: `risk-engine-write-failure-control-${randomUUID()}`, policyPath: path,
      })
      expect(verdict.allowed).toBe(true)
    })
  })
})
