import Decimal from 'decimal.js'
import type { RiskRule } from '../types.js'
import { orderNotional, existingPosition, equity } from './shared.js'

/** R8 — resulting position notional and % equity, after this order fills. */
export const r8ResultingPosition: RiskRule = {
  code: 'R8',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    const notional = orderNotional(ctx.operation.order, ctx.quote)
    if (notional === null) return null // R7 already fails closed on unestimable notional when the policy cares
    const existing = existingPosition(ctx, ctx.operation.contract.symbol)
    const existingNotional = existing ? new Decimal(existing.marketValue).abs() : new Decimal(0)
    const resultingNotional = existingNotional.plus(notional)

    if (ctx.policy.maxPositionNotional && resultingNotional.gt(ctx.policy.maxPositionNotional)) {
      return { code: 'R8', message: `resulting position notional ${resultingNotional.toFixed(2)} exceeds maxPositionNotional ${ctx.policy.maxPositionNotional}` }
    }
    if (ctx.policy.maxPositionPctEquity) {
      const eq = equity(ctx)
      if (eq.gt(0)) {
        const pct = resultingNotional.div(eq).mul(100)
        if (pct.gt(ctx.policy.maxPositionPctEquity)) {
          return { code: 'R8', message: `resulting position would be ${pct.toFixed(1)}% of equity, max is ${ctx.policy.maxPositionPctEquity}%` }
        }
      }
    }
    return null
  },
}
