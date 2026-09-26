import type { RiskRule } from '../types.js'

/** R5 — quote freshness. No quote at all fails closed; a quote older than maxQuoteAgeSeconds also rejects. */
export const r5QuoteFreshness: RiskRule = {
  code: 'R5',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (!ctx.quote) return { code: 'R5', message: 'no quote available' }
    const ageSeconds = (ctx.now.getTime() - new Date(ctx.quote.timestamp).getTime()) / 1000
    if (ageSeconds > ctx.policy.maxQuoteAgeSeconds) {
      return { code: 'R5', message: `quote is ${ageSeconds.toFixed(1)}s old, max is ${ctx.policy.maxQuoteAgeSeconds}s` }
    }
    return null
  },
}
