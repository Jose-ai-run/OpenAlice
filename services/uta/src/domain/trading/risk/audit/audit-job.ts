/**
 * [PROPUESTA] Independent audit job — Fase 4c (A5, ADR-0010).
 *
 * Cross-checks every executed `placeOrder`/`modifyOrder` operation in
 * `TradingGit`'s real commit log against `risk-decisions.jsonl`,
 * independent of the RiskEngine/auth preventive controls themselves —
 * a bug in either of those could fail silently; this is the check that
 * doesn't share their blind spots.
 *
 * Correlation is exact, not fuzzy: `RiskDecisionLogEntry.pendingHash` +
 * `operationIndex` (Fase 4c item 4) identify precisely which
 * `GitCommit.operations[i]` a decision belongs to — see risk-log.ts.
 *
 * `closePosition`/`cancelOrder` are skipped entirely — the RiskEngine
 * never evaluates them (ADR-0004, PROMPT_MASTER §14: always allowed),
 * so there is nothing to correlate for them.
 *
 * **Known limitation, stated rather than hidden:** the policy hash a
 * decision recorded is compared only informationally, not as a hard
 * failure — this repo does not retain a history of past policy
 * versions, so there is no way to verify "was this decision correct
 * under the policy that was actually live at that instant" once the
 * policy has since changed. A mismatch is surfaced as a note, not an
 * `AuditFinding` that forces `HALT_NEW` — a normal policy update over
 * time would otherwise trip the audit constantly.
 */
import type { GitCommit, OperationResult } from '@traderalice/uta-protocol'
import { readRiskDecisions, type RiskDecisionLogEntry } from '../risk-log.js'

export type AuditFindingKind = 'MISSING_DECISION' | 'RISK_BYPASSED' | 'PASS_DURING_HALT'

export interface AuditFinding {
  commitHash: string
  operationIndex: number
  operationAction: string
  kind: AuditFindingKind
  detail: string
}

export interface AuditResult {
  accountId: string
  at: string
  ok: boolean
  findings: AuditFinding[]
  /** Informational only — see the module docstring's "known limitation". */
  policyHashNotes: string[]
}

const RISK_GATED_ACTIONS = new Set(['placeOrder', 'modifyOrder'])

export interface AuditableAccount {
  id: string
  exportGitState(): { commits: readonly GitCommit[] }
}

export async function auditAccount(
  uta: AuditableAccount,
  currentPolicyHash: string | undefined,
  now: () => Date = () => new Date(),
): Promise<AuditResult> {
  const decisions = await readRiskDecisions(uta.id)
  const byKey = new Map<string, RiskDecisionLogEntry>()
  for (const d of decisions) {
    if (d.pendingHash !== undefined && d.operationIndex !== undefined) {
      byKey.set(`${d.pendingHash}:${d.operationIndex}`, d)
    }
  }

  const findings: AuditFinding[] = []
  const policyHashNotes: string[] = []
  const { commits } = uta.exportGitState()

  for (const commit of commits) {
    commit.operations.forEach((op, operationIndex) => {
      if (!RISK_GATED_ACTIONS.has(op.action)) return

      const decision = byKey.get(`${commit.hash}:${operationIndex}`)
      if (!decision) {
        findings.push({
          commitHash: commit.hash, operationIndex, operationAction: op.action,
          kind: 'MISSING_DECISION',
          detail: 'no matching RiskEngine decision found for this executed operation',
        })
        return
      }

      const result: OperationResult | undefined = commit.results[operationIndex]
      if (decision.allowed === false && result?.success === true) {
        findings.push({
          commitHash: commit.hash, operationIndex, operationAction: op.action,
          kind: 'RISK_BYPASSED',
          detail: `RiskEngine rejected this operation (${decision.ruleCode ?? 'unknown rule'}) but it succeeded anyway`,
        })
      }
      if (decision.allowed === true && decision.killSwitch !== 'NORMAL') {
        findings.push({
          commitHash: commit.hash, operationIndex, operationAction: op.action,
          kind: 'PASS_DURING_HALT',
          detail: `decision was allowed while the recorded kill switch was ${decision.killSwitch}`,
        })
      }

      if (currentPolicyHash && decision.policyHash !== currentPolicyHash) {
        policyHashNotes.push(
          `${commit.hash}:${operationIndex} was decided under policyHash ${decision.policyHash}, ` +
          `which differs from the current ${currentPolicyHash} — unverifiable without a policy-version ` +
          'history (see the module docstring); not treated as a discrepancy on its own.',
        )
      }
    })
  }

  return { accountId: uta.id, at: now().toISOString(), ok: findings.length === 0, findings, policyHashNotes }
}
