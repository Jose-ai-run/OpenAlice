import { describe, expect, it, vi, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataPath } from '@/core/paths.js'
import { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import { MockBroker } from '../../brokers/mock/index.js'
import { getKillSwitchStatus } from '../kill-switch.js'
import { runAuditAndEnforce } from './audit-runner.js'

/**
 * [PROPUESTA] Fase 4c (A5, ADR-0010) acceptance test, using a REAL
 * stage -> commit -> push fixture (not a synthetic one) — "una
 * operación ejecutada sin PASS" is built by letting a real push
 * complete normally (which logs a real, correlated PASS) and then
 * simulating the failure mode the audit exists to catch: the decision
 * log entry being lost (deleted/corrupted) after the fact, while the
 * commit itself remains in `TradingGit`'s real history. A clean ledger
 * (nothing deleted) must pass with zero side effects.
 */

const PERMISSIVE_POLICY = {
  version: 1,
  accounts: { default: { requireStopLoss: false, tradingHours: 'always' } },
}

async function withPolicyFile(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'audit-runner-spec-'))
  const path = join(dir, 'risk-policy.json')
  await writeFile(path, JSON.stringify(PERMISSIVE_POLICY))
  try {
    await fn(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function decisionsLogPath(accountId: string): string {
  return dataPath('trading', accountId, '_risk', 'risk-decisions.jsonl')
}

function auditLogPath(accountId: string): string {
  return dataPath('trading', accountId, '_risk', 'audit.jsonl')
}

const originalEnv = { ...process.env }
afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('runAuditAndEnforce — end to end against a real push (Fase 4c, A5)', () => {
  it('no-ops entirely when the RiskEngine flag is off — nothing to audit', async () => {
    delete process.env['OPENALICE_RISK_ENGINE_ENABLED']
    const accountId = `audit-flagoff-${randomUUID()}`
    const broker = new MockBroker({ id: accountId })
    const uta = new UnifiedTradingAccount(broker)
    const result = await runAuditAndEnforce(uta)
    expect(result).toBeNull()
  })

  it('a clean ledger (real push, decision log intact) passes with no HALT_NEW and no audit.jsonl', async () => {
    await withPolicyFile(async (policyPath) => {
      process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
      process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
      const accountId = `audit-clean-e2e-${randomUUID()}`
      const broker = new MockBroker({ id: accountId })
      const uta = new UnifiedTradingAccount(broker)

      uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
      uta.commit('test')
      await uta.push(uta.status().pendingHash!)

      const result = await runAuditAndEnforce(uta)
      expect(result?.ok).toBe(true)
      expect(result?.findings).toEqual([])

      const status = await getKillSwitchStatus(accountId, new Date())
      expect(status).toBe('NORMAL')
      await expect(readFile(auditLogPath(accountId), 'utf-8')).rejects.toThrow()
    })
  })

  it('an operation executed with no matching PASS (log entry lost after the fact) fails the audit, forces HALT_NEW, logs an alert, and persists the finding', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await withPolicyFile(async (policyPath) => {
      process.env['OPENALICE_RISK_ENGINE_ENABLED'] = '1'
      process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
      const accountId = `audit-missing-e2e-${randomUUID()}`
      const broker = new MockBroker({ id: accountId })
      const uta = new UnifiedTradingAccount(broker)

      uta.stagePlaceOrder({ aliceId: `${accountId}|AAPL`, action: 'BUY', orderType: 'MKT', totalQuantity: '1' })
      uta.commit('test')
      await uta.push(uta.status().pendingHash!)

      // Simulate the real failure mode this job exists to catch: the
      // decision log entry is gone (disk issue, truncation, accidental
      // deletion) even though the commit genuinely executed.
      await unlink(decisionsLogPath(accountId))

      const result = await runAuditAndEnforce(uta)
      expect(result?.ok).toBe(false)
      expect(result?.findings[0]).toMatchObject({ kind: 'MISSING_DECISION' })

      const status = await getKillSwitchStatus(accountId, new Date())
      expect(status).toBe('HALT_NEW')

      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('failed the independent audit'))

      const persisted = await readFile(auditLogPath(accountId), 'utf-8')
      expect(persisted).toContain('MISSING_DECISION')
    })
  })
})
