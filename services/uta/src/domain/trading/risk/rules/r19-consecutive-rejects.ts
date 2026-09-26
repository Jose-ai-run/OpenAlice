import type { RiskRule } from '../types.js'

/** R19 — too many consecutive rejects trips the kill switch (probable systematic misconfiguration, not one-off noise). */
export const r19ConsecutiveRejects: RiskRule = {
  code: 'R19',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (!ctx.policy.maxConsecutiveRejects) return null
    if (ctx.state.consecutiveRejects >= ctx.policy.maxConsecutiveRejects) {
      return {
        code: 'R19',
        message: `${ctx.state.consecutiveRejects} consecutive rejects reached maxConsecutiveRejects ${ctx.policy.maxConsecutiveRejects}`,
        killSwitch: 'HALT_NEW',
      }
    }
    return null
  },
}
