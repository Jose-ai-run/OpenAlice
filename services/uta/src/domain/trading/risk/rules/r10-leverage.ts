import type { RiskRule } from '../types.js'
import { orderNotional, grossExposure, equity } from './shared.js'

/** R10 — leverage (gross exposure / equity), after this order fills. */
export const r10Leverage: RiskRule = {
  code: 'R10',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (!ctx.policy.maxLeverage) return null
    const notional = orderNotional(ctx.operation.order, ctx.quote)
    if (notional === null) return null
    const eq = equity(ctx)
    if (eq.lte(0)) return { code: 'R10', message: 'account equity is not positive' }
    const leverage = grossExposure(ctx).plus(notional).div(eq)
    if (leverage.gt(ctx.policy.maxLeverage)) {
      return { code: 'R10', message: `resulting leverage ${leverage.toFixed(2)}x exceeds maxLeverage ${ctx.policy.maxLeverage}x` }
    }
    return null
  },
}
