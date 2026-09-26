import Decimal from 'decimal.js'
import type { RiskRule } from '../types.js'
import { estimateOrderPrice, equity } from './shared.js'

/** R15 — risk per trade as % of equity: |entry - stop| * qty / equity. Depends on R14 having already required a stop. */
export const r15RiskPerTrade: RiskRule = {
  code: 'R15',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (!ctx.policy.maxRiskPerTradePctEquity) return null
    const entry = estimateOrderPrice(ctx.operation.order, ctx.quote)
    if (!entry) return null // R7 already fails closed on unestimable price when the policy needs one

    const stopPriceStr = ctx.operation.tpsl?.stopLoss?.price
    const order = ctx.operation.order
    const stopFromOrder = order.orderType === 'STP' || order.orderType === 'STP LMT' ? order.auxPrice : null
    const stop = stopPriceStr ? new Decimal(stopPriceStr) : stopFromOrder
    if (!stop) return null // no stop to measure risk against — R14 covers "must have a stop" separately

    const eq = equity(ctx)
    if (eq.lte(0)) return { code: 'R15', message: 'account equity is not positive' }
    const riskPerUnit = entry.minus(stop).abs()
    const riskAmount = riskPerUnit.mul(order.totalQuantity)
    const riskPct = riskAmount.div(eq).mul(100)
    if (riskPct.gt(ctx.policy.maxRiskPerTradePctEquity)) {
      return { code: 'R15', message: `trade risks ${riskPct.toFixed(2)}% of equity, max is ${ctx.policy.maxRiskPerTradePctEquity}%` }
    }
    return null
  },
}
