import type { RiskRule } from '../types.js'
import { orderNotional, grossExposure, netExposure, equity } from './shared.js'

/** R9 — gross/net exposure across all positions, after this order fills. */
export const r9Exposure: RiskRule = {
  code: 'R9',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (!ctx.policy.maxGrossExposurePctEquity && !ctx.policy.maxNetExposurePctEquity) return null
    const notional = orderNotional(ctx.operation.order, ctx.quote)
    if (notional === null) return null
    const eq = equity(ctx)
    if (eq.lte(0)) return { code: 'R9', message: 'account equity is not positive' }

    const isBuy = ctx.operation.order.action === 'BUY'
    const signedNotional = isBuy ? notional : notional.neg()

    if (ctx.policy.maxGrossExposurePctEquity) {
      const grossPct = grossExposure(ctx).plus(notional).div(eq).mul(100)
      if (grossPct.gt(ctx.policy.maxGrossExposurePctEquity)) {
        return { code: 'R9', message: `resulting gross exposure ${grossPct.toFixed(1)}% exceeds maxGrossExposurePctEquity ${ctx.policy.maxGrossExposurePctEquity}%` }
      }
    }
    if (ctx.policy.maxNetExposurePctEquity) {
      const netPct = netExposure(ctx).plus(signedNotional).abs().div(eq).mul(100)
      if (netPct.gt(ctx.policy.maxNetExposurePctEquity)) {
        return { code: 'R9', message: `resulting net exposure ${netPct.toFixed(1)}% exceeds maxNetExposurePctEquity ${ctx.policy.maxNetExposurePctEquity}%` }
      }
    }
    return null
  },
}
