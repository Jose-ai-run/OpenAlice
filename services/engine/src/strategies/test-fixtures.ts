import type { Bar } from '@traderalice/uta-protocol'

/** Deterministic bar builder — no Math.random, no Date.now. */
function bar(dayOffset: number, open: number, high: number, low: number, close: number, volume = '1000'): Bar {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1 + dayOffset)),
    open: open.toFixed(4),
    high: high.toFixed(4),
    low: low.toFixed(4),
    close: close.toFixed(4),
    volume,
  }
}

/** Steadily rising closes — drives SMA crossovers, breakouts, and positive ROC. */
export function risingBars(n: number, start = 100): Bar[] {
  const bars: Bar[] = []
  let price = start
  for (let i = 0; i < n; i++) {
    const open = price
    price += 1 // deterministic +1/bar
    const close = price
    bars.push(bar(i, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close))
  }
  return bars
}

/** Steadily falling closes — mirror of risingBars. */
export function fallingBars(n: number, start = 200): Bar[] {
  const bars: Bar[] = []
  let price = start
  for (let i = 0; i < n; i++) {
    const open = price
    price -= 1
    const close = price
    bars.push(bar(i, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close))
  }
  return bars
}

/** Oscillating closes around a fixed mean — drives RSI extremes (mean reversion). */
export function oscillatingBars(n: number, mean = 100, amplitude = 15): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < n; i++) {
    // Deterministic triangle wave, not a sine (keeps arithmetic exact/simple).
    const phase = i % 20
    const offset = phase < 10 ? -amplitude + (phase * 2 * amplitude) / 10 : amplitude - ((phase - 10) * 2 * amplitude) / 10
    const close = mean + offset
    const open = close - 0.5
    bars.push(bar(i, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close))
  }
  return bars
}

/**
 * V-shaped: falls for the first half, rises for the second — guarantees a
 * genuine SMA crossunder then crossover (a straight monotonic series never
 * actually crosses; the fast/slow SMA gap on a linear ramp is constant).
 */
export function vShapedBars(n: number, peak = 150): Bar[] {
  const half = Math.floor(n / 2)
  const down = fallingBars(half, peak).map((b, i) => ({ ...b, timestamp: new Date(Date.UTC(2026, 0, 1 + i)) }))
  const bottom = Number(down[down.length - 1]!.close)
  const up = risingBars(n - half, bottom).map((b, i) => ({ ...b, timestamp: new Date(Date.UTC(2026, 0, 1 + half + i)) }))
  return [...down, ...up]
}

/** Flat/no-op closes — never crosses any threshold, always decides NONE. */
export function flatBars(n: number, price = 100): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < n; i++) bars.push(bar(i, price, price + 0.1, price - 0.1, price))
  return bars
}
