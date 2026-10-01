/**
 * [PROPUESTA] F6 metrics (ADR-0011 §5/§6, PROMPT_MASTER_CLAUDE_CODE.md §22).
 * Pure functions over a trade list + equity curve — no I/O, no randomness
 * (bootstrap.ts is the one place randomness/resampling lives).
 */
import type { BacktestTrade, BacktestResult } from './types.js'

export interface TradeMetrics {
  totalTrades: number
  totalPnl: number
  winRate: number
  avgWin: number
  avgLoss: number
  /** Sum(wins) / abs(Sum(losses)); Infinity if there are wins and zero losses. */
  profitFactor: number
  /** Mean pnlR across trades — expectancy expressed in R (ADR-0011 §5.2). */
  expectancyR: number
  /** Positive percentage, e.g. 8.5 = 8.5% drawdown. */
  maxDrawdownPct: number
  /** Annualized, from per-trade returns scaled by trades/year (documented method, ADR-0011 does not mandate one beyond "Sharpe"). */
  sharpeAnnualized: number
  /** Max single calendar month's share of total PnL, as a fraction (0.3 = 30%). NaN if totalPnl <= 0 (gate is moot there). */
  monthlyConcentration: number
}

export function maxDrawdownPct(equityCurve: BacktestResult['equityCurve']): number {
  let peak = equityCurve[0]?.equity ?? 0
  let maxDd = 0
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity
    if (peak > 0) {
      const dd = (peak - point.equity) / peak
      if (dd > maxDd) maxDd = dd
    }
  }
  return maxDd * 100
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/** Per-trade return = pnl / equity immediately before that trade (first equityCurve point at-or-before entry). */
function perTradeReturns(trades: BacktestTrade[], equityCurve: BacktestResult['equityCurve']): number[] {
  return trades.map((t) => {
    let equityBefore = equityCurve[0]?.equity ?? 0
    for (const p of equityCurve) {
      if (p.time.getTime() <= t.entryTime.getTime()) equityBefore = p.equity
      else break
    }
    return equityBefore > 0 ? t.pnl / equityBefore : 0
  })
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function computeMetrics(trades: BacktestTrade[], equityCurve: BacktestResult['equityCurve'], tradesPerYear: number): TradeMetrics {
  const totalTrades = trades.length
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl <= 0)
  const winRate = totalTrades > 0 ? wins.length / totalTrades : 0
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)
  const expectancyR = totalTrades > 0 ? trades.reduce((s, t) => s + t.pnlR, 0) / totalTrades : 0

  const returns = perTradeReturns(trades, equityCurve)
  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const sd = stddev(returns)
  const sharpeAnnualized = sd > 0 ? (meanReturn / sd) * Math.sqrt(tradesPerYear) : 0

  const byMonth = new Map<string, number>()
  for (const t of trades) byMonth.set(monthKey(t.exitTime), (byMonth.get(monthKey(t.exitTime)) ?? 0) + t.pnl)
  const monthlyConcentration = totalPnl > 0
    ? Math.max(0, ...[...byMonth.values()].map((v) => v / totalPnl))
    : NaN

  return {
    totalTrades, totalPnl, winRate, avgWin, avgLoss, profitFactor, expectancyR,
    maxDrawdownPct: maxDrawdownPct(equityCurve), sharpeAnnualized, monthlyConcentration,
  }
}
