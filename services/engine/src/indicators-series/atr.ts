/**
 * [PROPUESTA] Wilder ATR series — same algorithm as
 * src/domain/analysis/indicator/functions/technical.ts ATR() (initial
 * average of the first `period` true ranges, then Wilder smoothing),
 * computed at every index. See sma.ts for why this is a parallel series
 * module.
 */
export function atrSeries(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period: number,
): (number | null)[] {
  const n = highs.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (n < period + 1) return out

  const tr: number[] = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    )
  }

  let atr = 0
  for (let i = 1; i <= period; i++) atr += tr[i]!
  atr /= period
  out[period] = atr

  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]!) / period
    out[i] = atr
  }
  return out
}
