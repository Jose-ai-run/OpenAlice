import type { RiskRule } from '../types.js'
import { isProtectiveStopOrder } from './shared.js'

/**
 * R12 — trades per day, total and per symbol. Exempts protective-stop
 * orders (AUDIT.md §19, item 1a): a stop that protects an entry already
 * counted is risk-REDUCING, not a new trade — counting it against the
 * daily/per-symbol cap would make opening any position with a protective
 * stop cost two trade slots instead of one.
 */
export const r12TradesPerDay: RiskRule = {
  code: 'R12',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (isProtectiveStopOrder(ctx.operation)) return null
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
