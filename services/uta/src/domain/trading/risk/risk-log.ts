/**
 * [PROPUESTA] risk-decisions.jsonl — append-only audit log of every
 * RiskEngine evaluation, per PROMPT_MASTER_CLAUDE_CODE.md §14: "Registrar
 * cada evaluación ... con policyHash, entradas y resultado por regla."
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'
import type { Operation } from '../git/types.js'
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
}

function riskLogPath(accountId: string): string {
  return dataPath('trading', accountId, '_risk', 'risk-decisions.jsonl')
}

export function toLogEntry(accountId: string, operation: Operation, verdict: RiskVerdict, now: Date): RiskDecisionLogEntry {
  return {
    timestamp: now.toISOString(),
    accountId,
    operationAction: operation.action,
    policyHash: verdict.policyHash,
    allowed: verdict.allowed,
    ruleCode: verdict.ruleCode,
    reason: verdict.reason,
    killSwitch: verdict.killSwitch,
  }
}

export async function appendRiskDecision(accountId: string, entry: RiskDecisionLogEntry): Promise<void> {
  const filePath = riskLogPath(accountId)
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(entry)}\n`)
}
