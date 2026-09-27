/**
 * [PROPUESTA] risk-decisions.jsonl — append-only audit log of every
 * RiskEngine evaluation, per PROMPT_MASTER_CLAUDE_CODE.md §14: "Registrar
 * cada evaluación ... con policyHash, entradas y resultado por regla."
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'
import type { Operation } from '../git/types.js'
import type { OperationExecutionContext } from '../git/interfaces.js'
import type { RiskVerdict } from './types.js'

export interface RiskDecisionLogEntry {
  timestamp: string
  accountId: string
  operationAction: string
  policyHash: string
  allowed: boolean
  ruleCode?: string
  reason?: string
  killSwitch: 'NORMAL' | 'HALT_NEW' | 'FLATTEN'
  /**
   * [PROPUESTA] Fase 4c corrección item 4 (A5 requisito, no un pendiente) —
   * the hash of the commit this operation belongs to (known already at
   * `commit()` time, before `push()` ever evaluates risk — see
   * `TradingGit.executePush()`) and its position within that commit's
   * `operations[]` array. Together they let the independent audit
   * (ADR-0010) join a decision to its resulting `GitCommit` with zero
   * ambiguity, instead of fuzzy-matching by timestamp/account/action. Only
   * absent when a test calls `evaluateRisk` directly outside the real push
   * path — real production decisions always carry this.
   */
  pendingHash?: string
  operationIndex?: number
  /**
   * The broker-assigned order id — only exists for `modifyOrder`/
   * `cancelOrder` (both carry `operation.orderId` referencing an order
   * that already exists). `placeOrder` has no client-assigned id at
   * evaluation time — `Order.orderId` defaults to `0` and is filled in by
   * the broker only after submission (`packages/ibkr/src/order.ts`,
   * [VERIFICADO EN REPOSITORIO]) — so this is deliberately omitted for
   * `placeOrder` rather than logging a meaningless `0`.
   */
  orderId?: string
}

function riskLogPath(accountId: string): string {
  return dataPath('trading', accountId, '_risk', 'risk-decisions.jsonl')
}

function extractOrderId(operation: Operation): string | undefined {
  return operation.action === 'modifyOrder' || operation.action === 'cancelOrder' ? operation.orderId : undefined
}

export function toLogEntry(
  accountId: string, operation: Operation, verdict: RiskVerdict, now: Date,
  correlation?: OperationExecutionContext,
): RiskDecisionLogEntry {
  return {
    timestamp: now.toISOString(),
    accountId,
    operationAction: operation.action,
    policyHash: verdict.policyHash,
    allowed: verdict.allowed,
    ruleCode: verdict.ruleCode,
    reason: verdict.reason,
    killSwitch: verdict.killSwitch,
    pendingHash: correlation?.commitHash,
    operationIndex: correlation?.operationIndex,
    orderId: extractOrderId(operation),
  }
}

export async function appendRiskDecision(accountId: string, entry: RiskDecisionLogEntry): Promise<void> {
  const filePath = riskLogPath(accountId)
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(entry)}\n`)
}
