import type { Bar } from '@traderalice/uta-protocol'

/** [PROPUESTA] F6 (ADR-0011) — one completed backtest trade. */
export interface BacktestTrade {
  side: 'long' | 'short'
  entryTime: Date
  entryPrice: number
  stop: number
  exitTime: Date
  exitPrice: number
  exitReason: 'stop' | 'signal_exit' | 'end_of_data'
  qty: number
  /** Net of commission + slippage (ADR-0011 §3). */
  pnl: number
  /** PnL expressed in multiples of the initial risk (R) — pnl / riskAmount. */
  pnlR: number
  /** The ENTER decision's own score (0..1) — for A3 monotonicity. */
  score: number
}

export interface CostModel {
  /** Per-side commission in bps (ADR-0011 §3). */
  commissionBps: number
  /** Per-side slippage in bps, applied unfavorably. */
  slippageBps: number
}

export interface BacktestRunOptions {
  bars: readonly Bar[]
  strategy: import('../strategies/types.js').Strategy
  params: unknown
  costs: CostModel
  /** Fixed fraction of equity risked per trade (position-sizer.ts). */
  riskPct: number
  startingEquity: number
}

export interface BacktestResult {
  trades: BacktestTrade[]
  /** Equity curve, one point per trade exit, starting with startingEquity. */
  equityCurve: Array<{ time: Date; equity: number }>
}
