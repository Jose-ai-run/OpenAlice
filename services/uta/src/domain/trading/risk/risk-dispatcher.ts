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
import type { IBroker } from '../brokers/types.js'
import { evaluateRisk } from './risk-engine.js'

export function isRiskEngineEnabled(): boolean {
  return process.env['OPENALICE_RISK_ENGINE_ENABLED'] === '1'
}

export function wrapDispatcherWithRiskEngine(
  dispatcher: (op: Operation) => Promise<unknown>,
  broker: IBroker,
  accountId: string,
): (op: Operation) => Promise<unknown> {
  if (!isRiskEngineEnabled()) return dispatcher

  return async (op: Operation): Promise<unknown> => {
    if (op.action !== 'placeOrder' && op.action !== 'modifyOrder') {
      // closePosition and cancelOrder are always allowed — PROMPT_MASTER_CLAUDE_CODE.md §14.
      return dispatcher(op)
    }
    const verdict = await evaluateRisk(op, { broker, accountId })
    if (!verdict.allowed) {
      return { success: false, error: `[risk:${verdict.ruleCode}] ${verdict.reason}` }
    }
    return dispatcher(op)
  }
}
