/**
 * [PROPUESTA] Wilder RSI series — same core algorithm as
 * src/domain/analysis/indicator/functions/technical.ts RSI() (initial
 * average over the first `period` changes, then Wilder smoothing), computed
 * at every index instead of only the latest. See sma.ts for why this is a
 * parallel series module rather than calling the scalar function in a loop.
 *
 * Deliberate divergence from src/'s RSI() (src/ is NOT modified — this is
 * documented here, not fixed there): src/'s RSI() returns 100 whenever
 * `avgLoss === 0`, with no distinction between "there were gains and zero
 * losses" (RSI=100 is the standard, well-defined convention) and "there was
 * no price movement at all" (avgGain=0 AND avgLoss=0 — RSI is
 * mathematically undefined, not "maximally overbought"). This module
 * returns `null` for that second case instead of silently reusing 100 —
 * corrected 2026-09-25 after an earlier mistake where a test was adjusted
 * to accept the wrong value instead of the code being fixed; see
 * docs/trading-engine/AUDIT.md for the full account.
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
  out[period] = rsiFromAverages(avgGain, avgLoss)

  for (let i = period + 1; i < values.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period
    out[i] = rsiFromAverages(avgGain, avgLoss)
  }
  return out
}

function rsiFromAverages(avgGain: number, avgLoss: number): number | null {
  if (avgGain === 0 && avgLoss === 0) return null // undefined: no movement at all, not "overbought"
  if (avgLoss === 0) return 100 // well-defined: gains happened, zero losses
  return 100 - 100 / (1 + avgGain / avgLoss)
}
