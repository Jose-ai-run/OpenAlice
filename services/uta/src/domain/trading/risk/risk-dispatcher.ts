/**
 * [PROPUESTA] M1 insertion point — Fase 4a.
 *
 * "RiskEngine.check como PRIMER paso del dispatcher con guards (antes de
 * los guards existentes)" — PROMPT_MASTER_CLAUDE_CODE.md §5.
 *
 * With OPENALICE_RISK_ENGINE_ENABLED unset/not "1", this returns the exact
 * same `dispatcher` function reference untouched — zero behavior change,
 * zero overhead, byte-identical to pre-Fase-4a UnifiedTradingAccount.
 */
import type { Operation } from '../git/types.js'
import type { OperationExecutionContext } from '../git/interfaces.js'
import type { IBroker } from '../brokers/types.js'
import { evaluateRisk } from './risk-engine.js'

export function isRiskEngineEnabled(): boolean {
  return process.env['OPENALICE_RISK_ENGINE_ENABLED'] === '1'
}

export function wrapDispatcherWithRiskEngine(
  dispatcher: (op: Operation) => Promise<unknown>,
  broker: IBroker,
  accountId: string,
): (op: Operation, ctx?: OperationExecutionContext) => Promise<unknown> {
  if (!isRiskEngineEnabled()) return dispatcher

  return async (op: Operation, ctx?: OperationExecutionContext): Promise<unknown> => {
    if (op.action !== 'placeOrder' && op.action !== 'modifyOrder') {
      // closePosition and cancelOrder are always allowed — PROMPT_MASTER_CLAUDE_CODE.md §14.
      return dispatcher(op)
    }
    // [PROPUESTA] Fase 4c corrección item 4 — thread the commit this
    // operation belongs to into the risk-decision log so the independent
    // audit (ADR-0010) can join without ambiguity. `ctx` is only absent
    // when a caller invokes this dispatcher directly outside of
    // `TradingGit.executePush()` (unit tests) — production traffic always
    // supplies it (see TradingGit.ts's `executePush()`).
    const verdict = await evaluateRisk(op, { broker, accountId, correlation: ctx })
    if (!verdict.allowed) {
      return { success: false, error: `[risk:${verdict.ruleCode}] ${verdict.reason}` }
    }
    return dispatcher(op)
  }
}
