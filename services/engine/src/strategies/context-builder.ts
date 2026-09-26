import type { Bar, BarInterval } from '@traderalice/uta-protocol'
import { dropOpenBars } from '../data/quality.js'
import type { StrategyContext } from './types.js'

export interface BuildContextInput {
  /** Raw bars from a BarDataset (or any source) — NOT assumed to be pre-truncated. */
  bars: readonly Bar[]
  interval: BarInterval
  /** The instant this context represents "now" as. */
  asOf: Date
  params: unknown
  position?: StrategyContext['position']
}

/**
 * [PROPUESTA] THE authoritative boundary between raw market data and a
 * Strategy's view of history — added 2026-09-26 per explicit request after
 * the original no-lookahead mutation test (test/property/lookahead-trap.spec.ts)
 * was found to only prove its own bait mechanism, not a real production
 * guarantee (see docs/trading-engine/AUDIT.md).
 *
 * Guarantees `ctx.bars` NEVER includes:
 *   1. any bar timestamped strictly after `asOf`;
 *   2. the trailing bar if it has not closed by `asOf` (an "open candle").
 *
 * This is defense in depth: it does NOT trust that the caller (e.g.
 * MarketDataStore, or a future backtest replay loop that may hold the
 * FULL history in memory for efficiency) already filtered correctly.
 * Every Strategy consumer (the live Engine loop, a future Backtester,
 * tests) MUST go through this function rather than slicing `bars` by hand
 * — it is the single place the no-lookahead property is actually
 * enforced, not an implementation detail of any one caller.
 */
export function buildStrategyContext(input: BuildContextInput): StrategyContext {
  const upToAsOf = input.bars.filter((b) => b.timestamp.getTime() <= input.asOf.getTime())
  const closedOnly = dropOpenBars(upToAsOf, input.interval, input.asOf)
  return {
    bars: closedOnly,
    interval: input.interval,
    params: input.params,
    position: input.position,
  }
}
