import type { Strategy, StrategyContext, StrategyDecision } from './types.js'

/**
 * [PROPUESTA] Degenerate-input guard — added 2026-09-25 correcting an
 * earlier mistake (see docs/trading-engine/AUDIT.md for the full account):
 * an earlier version of mean-reversion.spec.ts adapted its expectations to
 * accept RSI=100 on a perfectly flat series instead of treating that as an
 * undefined/degenerate indicator. RSI on avgGain=avgLoss=0 is undefined,
 * not "maximally overbought"; a strategy must say so explicitly (NONE +
 * `DEGENERATE_INPUT`), not trade on it.
 */
export const DEGENERATE_INPUT = 'DEGENERATE_INPUT'

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function noneDegenerate(...reasons: string[]): StrategyDecision {
  return { kind: 'NONE', reasonCodes: [DEGENERATE_INPUT, ...reasons] }
}

/**
 * Final backstop, applied to every strategy via `withDegenerateGuard`:
 * whatever the strategy's own logic decided, refuse to emit an ENTER or
 * ADJUST_STOP carrying a non-finite number, or an ENTER whose stop is not
 * meaningfully distinct from its entry (a stop equal to entry — e.g. from
 * an ATR of exactly 0 — would trigger immediately, not protect anything).
 * This is deliberately generic: it catches degenerate cases a strategy's
 * own upstream checks did not anticipate, not just the ones each strategy
 * file already guards explicitly and more specifically.
 */
export function guardDecision(decision: StrategyDecision): StrategyDecision {
  if (decision.kind === 'ENTER') {
    const numericFields = [decision.entry, decision.stop, decision.score, decision.target, decision.timeStopBars]
      .filter((v) => v !== undefined)
    if (numericFields.some((v) => !isFiniteNumber(v))) {
      return noneDegenerate('non_finite_decision_field')
    }
    if (decision.entry === decision.stop) {
      return noneDegenerate('zero_width_stop')
    }
  }
  if (decision.kind === 'ADJUST_STOP' && !isFiniteNumber(decision.newStop)) {
    return noneDegenerate('non_finite_decision_field')
  }
  return decision
}

export function withDegenerateGuard(strategy: Strategy): Strategy {
  return {
    ...strategy,
    evaluate: (ctx: StrategyContext): StrategyDecision => guardDecision(strategy.evaluate(ctx)),
  }
}
