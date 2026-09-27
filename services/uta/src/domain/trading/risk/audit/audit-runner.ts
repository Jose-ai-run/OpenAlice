/**
 * [PROPUESTA] Audit enforcement — Fase 4c (A5, ADR-0010).
 *
 * Thin orchestration around the pure `auditAccount()` check: loads the
 * current policy hash (for the informational note only — see
 * audit-job.ts), forces `HALT_NEW` + logs + persists on a discrepancy.
 * No-ops entirely when the RiskEngine flag is off — with no RiskEngine
 * decisions ever recorded, there is nothing to cross-check, and running
 * this against every account's full git history on every boot for a
 * disabled feature would be pure overhead for zero signal.
 */
import { auditAccount, type AuditableAccount, type AuditResult } from './audit-job.js'
import { appendAuditResult } from './audit-log.js'
import { triggerKillSwitch } from '../kill-switch.js'
import { loadRiskPolicy, resolveRiskPolicyPath } from '../policy.js'
import { isRiskEngineEnabled } from '../risk-dispatcher.js'

export async function runAuditAndEnforce(
  uta: AuditableAccount,
  now: () => Date = () => new Date(),
): Promise<AuditResult | null> {
  if (!isRiskEngineEnabled()) return null

  const policyResult = await loadRiskPolicy(resolveRiskPolicyPath())
  const currentPolicyHash = policyResult.ok ? policyResult.policyHash : undefined

  const result = await auditAccount(uta, currentPolicyHash, now)
  if (!result.ok) {
    console.error(
      `[uta:audit] account "${uta.id}" failed the independent audit — forcing HALT_NEW. ` +
      `Findings: ${JSON.stringify(result.findings)}`,
    )
    await triggerKillSwitch(
      uta.id, 'HALT_NEW',
      `AUDIT_FAILURE: ${result.findings.map((f) => f.kind).join(', ')}`,
      now(),
    )
    await appendAuditResult(result).catch((err) => {
      console.error(`[uta:audit] also failed to persist the audit finding for "${uta.id}": ${err instanceof Error ? err.message : String(err)}`)
    })
  }
  return result
}
