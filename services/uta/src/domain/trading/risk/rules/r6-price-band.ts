import Decimal from 'decimal.js'
import type { RiskRule } from '../types.js'
import { estimateOrderPrice } from './shared.js'

/** R6 — price band. A limit price too far from the live quote is rejected (fat-finger / stale-limit guard). */
export const r6PriceBand: RiskRule = {
  code: 'R6',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (!ctx.policy.priceBandPct) return null
    if (!ctx.quote) return { code: 'R6', message: 'no quote available to compute price band' }
    const orderPrice = estimateOrderPrice(ctx.operation.order, ctx.quote)
    if (!orderPrice) return null // market order with no resolvable price — R5/R7 cover missing-quote cases
    const last = new Decimal(ctx.quote.last)
    if (last.isZero()) return { code: 'R6', message: 'quote last price is 0' }
    const deviationPct = orderPrice.minus(last).abs().div(last).mul(100)
    if (deviationPct.gt(ctx.policy.priceBandPct)) {
      return { code: 'R6', message: `order price deviates ${deviationPct.toFixed(2)}% from quote, band is ${ctx.policy.priceBandPct}%` }
    }
    return null
  },
}
