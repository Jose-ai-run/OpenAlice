import type { RiskRule } from '../types.js'

/** R12 — trades per day, total and per symbol. */
export const r12TradesPerDay: RiskRule = {
  code: 'R12',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (ctx.policy.maxTradesPerDay && ctx.state.tradesToday >= ctx.policy.maxTradesPerDay) {
      return { code: 'R12', message: `maxTradesPerDay ${ctx.policy.maxTradesPerDay} already reached` }
    }
    if (ctx.policy.maxTradesPerSymbolPerDay) {
      const symbol = ctx.operation.contract.symbol
      const count = ctx.state.tradesTodayBySymbol[symbol] ?? 0
      if (count >= ctx.policy.maxTradesPerSymbolPerDay) {
        return { code: 'R12', message: `maxTradesPerSymbolPerDay ${ctx.policy.maxTradesPerSymbolPerDay} already reached for "${symbol}"` }
      }
    }
    return null
  },
}
