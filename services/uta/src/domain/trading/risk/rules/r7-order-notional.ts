import type { RiskRule } from '../types.js'
import { orderNotional } from './shared.js'

/** R7 — order notional cap. */
export const r7OrderNotional: RiskRule = {
  code: 'R7',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (!ctx.policy.maxOrderNotional) return null
    const notional = orderNotional(ctx.operation.order, ctx.quote)
    if (notional === null) return { code: 'R7', message: 'cannot estimate order notional (no limit price and no quote)' }
    if (notional.gt(ctx.policy.maxOrderNotional)) {
      return { code: 'R7', message: `order notional ${notional.toFixed(2)} exceeds maxOrderNotional ${ctx.policy.maxOrderNotional}` }
    }
    return null
  },
}
