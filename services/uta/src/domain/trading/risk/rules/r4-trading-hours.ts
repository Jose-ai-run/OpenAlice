import type { RiskRule } from '../types.js'

/** R4 — trading hours. 'always' (crypto-style) skips the check entirely; 'marketHours' fails closed on a missing/closed clock. */
export const r4TradingHours: RiskRule = {
  code: 'R4',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (ctx.policy.tradingHours === 'always') return null
    if (!ctx.marketClock) return { code: 'R4', message: 'market clock unavailable' }
    if (!ctx.marketClock.isOpen) return { code: 'R4', message: 'market is closed' }
    return null
  },
}
