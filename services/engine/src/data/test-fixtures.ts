import type { Bar } from '@traderalice/uta-protocol'

/** Five clean daily bars, 2026-01-01..05, all OHLC valid, no gaps/dupes. */
export function cleanDailyBars(): Bar[] {
  const days = [1, 2, 3, 4, 5]
  return days.map((d, i) => ({
    timestamp: new Date(Date.UTC(2026, 0, d)),
    open: (100 + i).toFixed(2),
    high: (101 + i).toFixed(2),
    low: (99 + i).toFixed(2),
    close: (100.5 + i).toFixed(2),
    volume: '1000',
  }))
}
