import type { RiskRule } from '../types.js'
import { existingPosition } from './shared.js'

/** R11 — number of open positions. Only relevant when the order opens a NEW symbol (adding to an existing one doesn't increase the count). */
export const r11OpenPositions: RiskRule = {
  code: 'R11',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (!ctx.policy.maxOpenPositions) return null
    const symbol = ctx.operation.contract.symbol
    if (existingPosition(ctx, symbol)) return null // adding to an existing position, count unchanged
    if (ctx.positions.length + 1 > ctx.policy.maxOpenPositions) {
      return { code: 'R11', message: `opening "${symbol}" would exceed maxOpenPositions ${ctx.policy.maxOpenPositions}` }
    }
    return null
  },
}
