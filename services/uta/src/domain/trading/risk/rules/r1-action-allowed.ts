import type { RiskRule } from '../types.js'

/** R1 — the operation's action must be in the account's allowedActions (if the policy restricts it). */
export const r1ActionAllowed: RiskRule = {
  code: 'R1',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (!ctx.policy.allowedActions) return null
    if (!ctx.policy.allowedActions.includes(ctx.operation.action as 'placeOrder' | 'modifyOrder')) {
      return { code: 'R1', message: `action "${ctx.operation.action}" is not in allowedActions` }
    }
    return null
  },
}
