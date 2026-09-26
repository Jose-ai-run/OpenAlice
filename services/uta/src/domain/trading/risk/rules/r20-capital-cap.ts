import type { RiskRule } from '../types.js'
import { equity } from './shared.js'

/** R20 — hard capital ceiling. Independent of the %-of-equity rules above — an absolute dollar cap for capped pilot rollouts (PROMPT_MASTER_CLAUDE_CODE.md §25: "capitalCap pequeño"). */
export const r20CapitalCap: RiskRule = {
  code: 'R20',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (!ctx.policy.capitalCap) return null
    const eq = equity(ctx)
    if (eq.gt(ctx.policy.capitalCap)) {
      return { code: 'R20', message: `account equity ${eq.toFixed(2)} exceeds capitalCap ${ctx.policy.capitalCap}` }
    }
    return null
  },
}
