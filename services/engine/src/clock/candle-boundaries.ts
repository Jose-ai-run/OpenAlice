/**
 * [PROPUESTA] Candle-boundary math — Hito 1.
 *
 * Pure, injectable-clock-friendly arithmetic the scheduler uses to align
 * itself to interval close times (e.g. every hour on the hour for `1h`).
 * No I/O, no wall-clock reads — every function takes `from` explicitly.
 */
import type { BarInterval } from '@traderalice/uta-protocol'

const INTERVAL_MS: Record<BarInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
}

export function intervalMs(interval: BarInterval): number {
  return INTERVAL_MS[interval]
}

/** The most recent candle-close boundary at or before `from`. */
export function lastBoundaryAtOrBefore(from: Date, interval: BarInterval): Date {
  const ms = intervalMs(interval)
  return new Date(Math.floor(from.getTime() / ms) * ms)
}

/** The next candle-close boundary strictly after `from`. */
export function nextBoundaryAfter(from: Date, interval: BarInterval): Date {
  const ms = intervalMs(interval)
  return new Date((Math.floor(from.getTime() / ms) + 1) * ms)
}

/**
 * Milliseconds to wait, from `from`, until the next candle close plus a
 * publication margin (time for the venue to actually publish the closed
 * candle — a boundary crossing at :00:00.000 doesn't mean the venue's API
 * has the bar available yet).
 */
export function msUntilNextTick(from: Date, interval: BarInterval, marginMs: number): number {
  const boundary = nextBoundaryAfter(from, interval)
  return boundary.getTime() + marginMs - from.getTime()
}
