/**
 * [PROPUESTA] R21 — max bid/ask spread (A7a, Fase 4c, ADR-0010).
 * Corrección 2026-09-27 (Fase 4c aprobada con ajuste): trata cotizaciones
 * sintéticas como "sin datos" por defecto, con opt-in explícito por cuenta.
 *
 * Rejects when the live quote's spread exceeds the configured limit, or
 * when the quote doesn't look like real bid/ask data at all — fails
 * closed the same way R5 (quote freshness) and R6 (price band) already
 * do for a missing quote, rather than silently allowing a wide-spread
 * (or meaningless-spread) fill.
 *
 * **Verified against every broker pack before writing this** (per the
 * mandate's own instruction), because `Quote.bid`/`Quote.ask` are
 * non-optional strings on the wire — a broker with no real bid/ask
 * can't signal "unavailable" via `undefined`, only via a sentinel value.
 * Three shapes are treated as "not real bid/ask data" (`looksSynthetic`
 * below), never silently averaged into a spread number:
 *   1. `bid` or `ask` non-positive — the sentinel CCXT/IBKR use when
 *      their ticker has none (`brokers/ccxt/CcxtBroker.ts:1237-1238`,
 *      `brokers/ibkr/IbkrBroker.ts:818-819`, [VERIFICADO EN REPOSITORIO]).
 *   2. `bid === ask` — **Leverup**
 *      (`brokers/others/leverup/LeverupBroker.ts:506-507`,
 *      [VERIFICADO EN REPOSITORIO]) sets `bid: last, ask: last` with the
 *      explicit comment "Pyth gives mid; no bid/ask split": not real
 *      bid/ask, a synthetic stand-in that would otherwise compute to a
 *      spread of exactly `0` and pass every positive `maxSpreadBps`
 *      trivially — the opposite of protection.
 *   3. `bid > ask` — a crossed quote. Never legitimate; broker-side data
 *      corruption or a transient glitch, not a real market state to
 *      trade against.
 *
 * **Default: reject all three** (fail-closed, matching every other rule
 * in this chain). **Opt-in per account:** `policy.allowSyntheticQuotes`
 * (default `false`) — an operator who has read this docstring and
 * accepts that R21 provides no real protection for a specific account
 * (Leverup, or any keyless/synthetic-quote source) can set it explicitly
 * in the RO policy file. With it set, a synthetic-looking quote is not
 * rejected — R21 simply doesn't evaluate a spread for it, the same as if
 * `maxSpreadBps` were unset for that account. It does NOT attempt to
 * compute a spread number from a crossed or degenerate quote (that would
 * produce a meaningless, possibly-negative "spread" that trivially
 * passes any limit) — the honest behavior is "this rule does not apply
 * here," not "here is a fabricated number."
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
    const looksSynthetic = bid.lte(0) || ask.lte(0) || bid.eq(ask) || bid.gt(ask)

    if (looksSynthetic) {
      if (ctx.policy.allowSyntheticQuotes) return null
      return {
        code: 'R21',
        message: `quote does not look like real bid/ask (bid=${ctx.quote.bid}, ask=${ctx.quote.ask}) — ` +
          'set policy.allowSyntheticQuotes=true for this account if this is expected (e.g. Leverup)',
      }
    }

    const mid = bid.plus(ask).div(2)
    const spreadBps = ask.minus(bid).div(mid).mul(10_000)
    if (spreadBps.gt(ctx.policy.maxSpreadBps)) {
      return { code: 'R21', message: `spread is ${spreadBps.toFixed(1)}bps, max is ${ctx.policy.maxSpreadBps}bps` }
    }
    return null
  },
}
