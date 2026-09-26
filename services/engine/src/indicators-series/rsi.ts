/**
 * [PROPUESTA] Wilder RSI series — same algorithm as
 * src/domain/analysis/indicator/functions/technical.ts RSI() (initial
 * average over the first `period` changes, then Wilder smoothing), computed
 * at every index instead of only the latest. See sma.ts for why this is a
 * parallel series module rather than calling the scalar function in a loop.
 */
export function rsiSeries(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period + 1) return out

  const gains: number[] = new Array(values.length).fill(0)
  const losses: number[] = new Array(values.length).fill(0)
  for (let i = 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!
    gains[i] = change > 0 ? change : 0
    losses[i] = change < 0 ? -change : 0
  }

  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    avgGain += gains[i]!
    avgLoss += losses[i]!
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < values.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}
