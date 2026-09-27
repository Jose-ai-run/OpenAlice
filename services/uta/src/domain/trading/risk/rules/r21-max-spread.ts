/**
 * [PROPUESTA] R21 — max bid/ask spread (A7a, Fase 4c, ADR-0010).
 *
 * Rejects when the live quote's spread exceeds the configured limit, or
 * when no usable bid/ask is available at all — fails closed the same
 * way R5 (quote freshness) and R6 (price band) already do for a missing
 * quote, rather than silently allowing a wide-spread fill.
 *
 * **Verified against every broker pack before writing this** (per the
 * mandate's own instruction), because `Quote.bid`/`Quote.ask` are
 * non-optional strings on the wire — a broker with no real bid/ask
 * can't signal "unavailable" via `undefined`, only via a sentinel value:
 * - Alpaca, IBKR, CCXT, Longbridge, MockBroker: real bid/ask (CCXT/IBKR
 *   fall back to `'0'` when the ticker has none — caught below).
 * - **Leverup** (`brokers/others/leverup/LeverupBroker.ts:506-507`,
 *   [VERIFICADO EN REPOSITORIO]): sets `bid: last, ask: last` with the
 *   explicit comment "Pyth gives mid; no bid/ask split" — this is NOT
 *   real bid/ask data. `spreadBps` computes to exactly `0` for every
 *   Leverup quote, so R21 provides **no actual protection** on Leverup
 *   accounts (a spread of 0 never exceeds a positive `maxSpreadBps`).
 *   This is a known, documented gap — not silently swallowed — see
 *   docs/risk-engine.md. Detecting "bid === ask" generically as
 *   "unavailable" was considered and rejected: a real broker can
 *   legitimately report a momentarily zero spread in a liquid market,
 *   and flagging that as a rejection would be a false positive
 *   elsewhere. Leverup's case is structural (every quote, always), not
 *   an edge case a generic check could safely distinguish from a real
 *   tight market without broker-specific knowledge this rule shouldn't
 *   need to carry.
 */
import Decimal from 'decimal.js'
import type { RiskRule } from '../types.js'

export const r21MaxSpread: RiskRule = {
  code: 'R21',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (!ctx.policy.maxSpreadBps) return null
    if (!ctx.quote) return { code: 'R21', message: 'no quote available to compute spread' }

    const bid = new Decimal(ctx.quote.bid)
    const ask = new Decimal(ctx.quote.ask)
    if (bid.lte(0) || ask.lte(0)) {
      return { code: 'R21', message: 'quote has no usable bid/ask (broker reported a non-positive value)' }
    }

    const mid = bid.plus(ask).div(2)
    if (mid.lte(0)) return { code: 'R21', message: 'quote mid price is 0' }

    const spreadBps = ask.minus(bid).div(mid).mul(10_000)
    if (spreadBps.gt(ctx.policy.maxSpreadBps)) {
      return { code: 'R21', message: `spread is ${spreadBps.toFixed(1)}bps, max is ${ctx.policy.maxSpreadBps}bps` }
    }
    return null
  },
}
