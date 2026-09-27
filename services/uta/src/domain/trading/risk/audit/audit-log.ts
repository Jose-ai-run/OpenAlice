/**
 * [PROPUESTA] audit.jsonl — Fase 4c (A5, ADR-0010).
 *
 * Only written when a discrepancy is found — the absence of this file
 * (or an existing one with no new lines) is the expected state in
 * normal operation, per ADR-0010: "un ledger consistente no produce
 * ninguna alerta ni entrada."
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'
import type { AuditResult } from './audit-job.js'

function auditLogPath(accountId: string): string {
  return dataPath('trading', accountId, '_risk', 'audit.jsonl')
}

export async function appendAuditResult(result: AuditResult): Promise<void> {
  const filePath = auditLogPath(result.accountId)
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(result)}\n`)
}
