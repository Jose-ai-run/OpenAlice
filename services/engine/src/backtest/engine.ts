/**
 * [PROPUESTA] F6 event-driven backtester (ADR-0011 §3/§9,
 * PROMPT_MASTER_CLAUDE_CODE.md §22). Uses the EXACT SAME strategy/context
 * code as paper/live: `buildStrategyContext` (no-lookahead, Fase 3) and
 * `strategy.evaluate()` — never a parallel "backtest-only" decision path.
 * Position sizing reuses `sizing/position-sizer.ts` unchanged.
 *
 * Fill model (ADR-0011 §3, fixed, pre-registered):
 *  - Entry at the OPEN of the bar AFTER the signal bar (never same-bar).
 *  - Stop/target fill at the EXACT level (not the bar's own price).
 *  - If both stop and target fall within one bar's [low, high], the stop
 *    wins (conservative tie-break).
 *  - Commission (bps) + slippage (bps) applied per side, every fill.
 *  - Funding NOT modeled here — see the separate sensitivity pass
 *    (ADR-0011 §3), never part of this function's own output.
 */
import type { BarInterval } from '@traderalice/uta-protocol'
import { buildStrategyContext } from '../strategies/context-builder.js'
import { intervalMs } from '../clock/candle-boundaries.js'
import { sizePosition } from '../sizing/position-sizer.js'
import type { BacktestRunOptions, BacktestResult, BacktestTrade } from './types.js'

function applySlippage(price: number, bps: number, direction: 'buy' | 'sell'): number {
  const delta = price * (bps / 10_000)
  return direction === 'buy' ? price + delta : price - delta
}

export function runBacktest(opts: BacktestRunOptions, interval: BarInterval): BacktestResult {
  const { bars, strategy, params, costs, riskPct } = opts
  const ms = intervalMs(interval)
  const trades: BacktestTrade[] = []
  let equity = opts.startingEquity
  const equityCurve: BacktestResult['equityCurve'] = bars[0] ? [{ time: bars[0].timestamp, equity }] : []

  let idx = 0
  while (idx < bars.length - 1) {
    const closeAt = new Date(bars[idx]!.timestamp.getTime() + ms)
    const ctx = buildStrategyContext({ bars: bars.slice(0, idx + 1), interval, asOf: closeAt, params })
    const decision = strategy.evaluate(ctx)

    if (decision.kind !== 'ENTER') { idx++; continue }

    const entryBar = bars[idx + 1]
    if (!entryBar) break  // no bar left to fill the entry on

    const rawEntryPrice = Number(entryBar.open)
    const entryPrice = applySlippage(rawEntryPrice, costs.slippageBps, decision.side === 'long' ? 'buy' : 'sell')

    const sizing = sizePosition({ equity, riskPct, entry: entryPrice, stop: decision.stop, minQty: 0.0001, lotSize: 0.0001 })
    const qty = sizing.quantity.toNumber()
    if (qty <= 0) { idx++; continue }  // sizing fell below minQty — skip this signal, not a trade
    const riskAmount = sizing.riskAmount.toNumber()

    let position = { side: decision.side, entry: entryPrice, stop: decision.stop }
    let exitIdx = -1
    let exitPrice = 0
    let exitReason: BacktestTrade['exitReason'] = 'end_of_data'

    for (let j = idx + 2; j < bars.length; j++) {
      const bar = bars[j]!
      const low = Number(bar.low)
      const high = Number(bar.high)
      const stoppedOut = position.side === 'long' ? low <= position.stop : high >= position.stop
      if (stoppedOut) { exitIdx = j; exitPrice = position.stop; exitReason = 'stop'; break }

      const exitCloseAt = new Date(bar.timestamp.getTime() + ms)
      const exitCtx = buildStrategyContext({ bars: bars.slice(0, j + 1), interval, asOf: exitCloseAt, params, position })
      const exitDecision = strategy.evaluate(exitCtx)
      if (exitDecision.kind === 'EXIT') { exitIdx = j; exitPrice = Number(bar.close); exitReason = 'signal_exit'; break }
      if (exitDecision.kind === 'ADJUST_STOP') {
        const tightened = position.side === 'long'
          ? Math.max(position.stop, exitDecision.newStop)
          : Math.min(position.stop, exitDecision.newStop)
        position = { ...position, stop: tightened }
      }
    }

    if (exitIdx === -1) {
      exitIdx = bars.length - 1
      exitPrice = Number(bars[exitIdx]!.close)
      exitReason = 'end_of_data'
    }

    const exitPriceAdj = applySlippage(exitPrice, costs.slippageBps, position.side === 'long' ? 'sell' : 'buy')
    const grossPnl = position.side === 'long' ? (exitPriceAdj - entryPrice) * qty : (entryPrice - exitPriceAdj) * qty
    const entryCommission = entryPrice * qty * (costs.commissionBps / 10_000)
    const exitCommission = exitPriceAdj * qty * (costs.commissionBps / 10_000)
    const netPnl = grossPnl - entryCommission - exitCommission

    equity += netPnl
    const exitBar = bars[exitIdx]!
    trades.push({
      side: position.side, entryTime: entryBar.timestamp, entryPrice, stop: decision.stop,
      exitTime: exitBar.timestamp, exitPrice: exitPriceAdj, exitReason, qty,
      pnl: netPnl, pnlR: riskAmount > 0 ? netPnl / riskAmount : 0, score: decision.score,
    })
    equityCurve.push({ time: exitBar.timestamp, equity })

    idx = exitIdx + 1
  }

  return { trades, equityCurve }
}
