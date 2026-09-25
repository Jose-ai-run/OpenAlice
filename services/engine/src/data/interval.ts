import type { BarInterval } from '@traderalice/uta-protocol'

/** Bar interval expressed in milliseconds — used for gap/open-bar math. */
export const INTERVAL_MS: Record<BarInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
}

export function intervalToMs(interval: BarInterval): number {
  return INTERVAL_MS[interval]
}
