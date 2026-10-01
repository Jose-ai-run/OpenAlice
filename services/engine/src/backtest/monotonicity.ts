/**
 * [PROPUESTA] A3 — expectancy-by-score-quintile monotonicity (ADR-0011 §7).
 * Pure — operates on the trade list only.
 */
import type { BacktestTrade } from './types.js'

export interface MonotonicityResult {
  status: 'pass' | 'fail' | 'n/a'
  quintileExpectancy: number[]
  spearman: number | null
  reason?: string
}

function spearmanCorrelation(ranks: number[], values: number[]): number {
  const n = ranks.length
  const rankOf = (arr: number[]): number[] => {
    const sorted = [...arr].map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
    const r = new Array(n).fill(0)
    sorted.forEach(([, origIdx], pos) => { r[origIdx] = pos + 1 })
    return r
  }
  const rv = rankOf(values)
  const d2 = ranks.map((r, i) => (r - rv[i]!) ** 2).reduce((a, b) => a + b, 0)
  return 1 - (6 * d2) / (n * (n ** 2 - 1))
}

/** PASS if the Spearman correlation between quintile rank (1..5) and mean expectancy (R) is >= 0. N/A below the minimum sample size. */
export function checkMonotonicity(trades: readonly BacktestTrade[], minPerQuintile = 5): MonotonicityResult {
  if (trades.length < minPerQuintile * 5) {
    return { status: 'n/a', quintileExpectancy: [], spearman: null, reason: `insufficient trades (${trades.length}) for 5 quintiles of >=${minPerQuintile} each` }
  }
  const sorted = [...trades].sort((a, b) => a.score - b.score)
  const quintileSize = Math.floor(sorted.length / 5)
  const quintileExpectancy: number[] = []
  for (let q = 0; q < 5; q++) {
    const slice = q === 4 ? sorted.slice(q * quintileSize) : sorted.slice(q * quintileSize, (q + 1) * quintileSize)
    const meanR = slice.reduce((s, t) => s + t.pnlR, 0) / slice.length
    quintileExpectancy.push(meanR)
  }
  const ranks = [1, 2, 3, 4, 5]
  const spearman = spearmanCorrelation(ranks, quintileExpectancy)
  return { status: spearman >= 0 ? 'pass' : 'fail', quintileExpectancy, spearman }
}
