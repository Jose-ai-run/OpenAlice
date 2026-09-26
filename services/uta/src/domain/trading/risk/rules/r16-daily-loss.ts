import Decimal from 'decimal.js'
import type { RiskRule } from '../types.js'
import { equity } from './shared.js'

/**
 * R16 — daily loss limit. Triggers HALT_NEW (not FLATTEN — PROMPT_MASTER
 * §16 lists R16 among the kill-triggering rules but reserves FLATTEN for
 * an explicit, confirmed operator action per §34). risk-engine.ts
 * initializes `state.dailyStartEquity` on the first evaluation of a new
 * day, before any rule runs.
 */
export const r16DailyLoss: RiskRule = {
  code: 'R16',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (!ctx.policy.maxDailyLossPctEquity) return null
    if (!ctx.state.dailyStartEquity) return null // risk-engine.ts always sets this before rules run; defensive only
    const start = new Decimal(ctx.state.dailyStartEquity)
    if (start.lte(0)) return null
    const current = equity(ctx)
    const lossPct = start.minus(current).div(start).mul(100)
    if (lossPct.gt(ctx.policy.maxDailyLossPctEquity)) {
      return {
        code: 'R16',
        message: `daily loss ${lossPct.toFixed(2)}% exceeds maxDailyLossPctEquity ${ctx.policy.maxDailyLossPctEquity}%`,
        killSwitch: 'HALT_NEW',
      }
    }
    return null
  },
}
