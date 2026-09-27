import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'
import type { GitCommit, Operation } from '@traderalice/uta-protocol'
import { auditAccount, type AuditableAccount } from './audit-job.js'
import type { RiskDecisionLogEntry } from '../risk-log.js'

function riskLogPath(accountId: string): string {
  return dataPath('trading', accountId, '_risk', 'risk-decisions.jsonl')
}

async function seedDecisions(accountId: string, entries: RiskDecisionLogEntry[]): Promise<void> {
  const path = riskLogPath(accountId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

function makePlaceOrderOp(): Operation {
  return { action: 'placeOrder', contract: {} as never, order: {} as never }
}

function makeCommit(hash: string, operations: Operation[], results: Array<{ success: boolean }>): GitCommit {
  return {
    hash, parentHash: null, message: 'test', operations,
    results: results.map((r, i) => ({ action: operations[i]!.action, success: r.success, status: r.success ? 'submitted' : 'rejected' })),
    stateAfter: { netLiquidation: '0', totalCashValue: '0', unrealizedPnL: '0', realizedPnL: '0', positions: [], pendingOrders: [] },
    timestamp: new Date().toISOString(),
  }
}

function makeDecision(overrides: Partial<RiskDecisionLogEntry> = {}): RiskDecisionLogEntry {
  return {
    timestamp: new Date().toISOString(),
    accountId: 'x',
    operationAction: 'placeOrder',
    policyHash: 'hash1',
    allowed: true,
    killSwitch: 'NORMAL',
    ...overrides,
  }
}

function fakeAccount(id: string, commits: GitCommit[]): AuditableAccount {
  return { id, exportGitState: () => ({ commits }) }
}

describe('auditAccount — pure cross-check logic (Fase 4c, A5, ADR-0010)', () => {
  it('a clean ledger (every executed operation has its matching PASS) passes with no findings', async () => {
    const accountId = `audit-clean-${randomUUID()}`
    const commit = makeCommit('c1', [makePlaceOrderOp()], [{ success: true }])
    await seedDecisions(accountId, [
      makeDecision({ accountId, pendingHash: 'c1', operationIndex: 0, allowed: true }),
    ])
    const result = await auditAccount(fakeAccount(accountId, [commit]), 'hash1')
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
  })

  it('an operation executed with no matching decision at all -> MISSING_DECISION', async () => {
    const accountId = `audit-missing-${randomUUID()}`
    const commit = makeCommit('c1', [makePlaceOrderOp()], [{ success: true }])
    // No decisions seeded at all — simulates a lost/never-written log entry.
    const result = await auditAccount(fakeAccount(accountId, [commit]), 'hash1')
    expect(result.ok).toBe(false)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ commitHash: 'c1', operationIndex: 0, kind: 'MISSING_DECISION' })
  })

  it('a decision recorded as rejected, but the operation succeeded anyway -> RISK_BYPASSED', async () => {
    const accountId = `audit-bypassed-${randomUUID()}`
    const commit = makeCommit('c1', [makePlaceOrderOp()], [{ success: true }])
    await seedDecisions(accountId, [
      makeDecision({ accountId, pendingHash: 'c1', operationIndex: 0, allowed: false, ruleCode: 'R14' }),
    ])
    const result = await auditAccount(fakeAccount(accountId, [commit]), 'hash1')
    expect(result.ok).toBe(false)
    expect(result.findings[0]).toMatchObject({ kind: 'RISK_BYPASSED' })
  })

  it('an allowed decision recorded while the kill switch was already HALT_NEW -> PASS_DURING_HALT', async () => {
    const accountId = `audit-halt-${randomUUID()}`
    const commit = makeCommit('c1', [makePlaceOrderOp()], [{ success: true }])
    await seedDecisions(accountId, [
      makeDecision({ accountId, pendingHash: 'c1', operationIndex: 0, allowed: true, killSwitch: 'HALT_NEW' }),
    ])
    const result = await auditAccount(fakeAccount(accountId, [commit]), 'hash1')
    expect(result.ok).toBe(false)
    expect(result.findings[0]).toMatchObject({ kind: 'PASS_DURING_HALT' })
  })

  it('closePosition/cancelOrder operations are skipped entirely — the RiskEngine never evaluates them', async () => {
    const accountId = `audit-skip-${randomUUID()}`
    const closeOp: Operation = { action: 'closePosition', contract: {} as never }
    const commit = makeCommit('c1', [closeOp], [{ success: true }])
    const result = await auditAccount(fakeAccount(accountId, [commit]), 'hash1')
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
  })

  it('a policyHash mismatch is an informational note, not a hard finding (policy changes over time are normal)', async () => {
    const accountId = `audit-policy-note-${randomUUID()}`
    const commit = makeCommit('c1', [makePlaceOrderOp()], [{ success: true }])
    await seedDecisions(accountId, [
      makeDecision({ accountId, pendingHash: 'c1', operationIndex: 0, allowed: true, policyHash: 'old-hash' }),
    ])
    const result = await auditAccount(fakeAccount(accountId, [commit]), 'current-hash')
    expect(result.ok).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.policyHashNotes).toHaveLength(1)
  })
})
