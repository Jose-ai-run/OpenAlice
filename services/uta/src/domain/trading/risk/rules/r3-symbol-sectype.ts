import type { RiskRule } from '../types.js'

/** R3 — symbol/secType allowlists (placeOrder only; modifyOrder has no contract on the operation). */
export const r3SymbolSecType: RiskRule = {
  code: 'R3',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    const { symbol, secType } = ctx.operation.contract
    if (ctx.policy.allowedSymbols && !ctx.policy.allowedSymbols.includes(symbol)) {
      return { code: 'R3', message: `symbol "${symbol}" is not in allowedSymbols` }
    }
    if (ctx.policy.allowedSecTypes && secType && !ctx.policy.allowedSecTypes.includes(secType)) {
      return { code: 'R3', message: `secType "${secType}" is not in allowedSecTypes` }
    }
    return null
  },
}
