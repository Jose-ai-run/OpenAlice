/**
 * [PROPUESTA] F6 grid runner (ADR-0011) — walks the pre-registered grid
 * (§2) over BTC/ETH × 1h/4h, walk-forward (§4), evaluates gates (§5) on
 * the aggregated OOS trades, and for every combination that passes ALL
 * gates, runs the holdout ONCE. Writes a JSON results file the report
 * generator reads — this script never writes prose, only numbers.
 */
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import type { Bar } from '@traderalice/uta-protocol'
import { openDatabase } from '../db/database.js'
import { readBars } from '../data/market-bars-store.js'
import { runBacktest } from '../backtest/engine.js'
import { computeMetrics, type TradeMetrics } from '../backtest/metrics.js'
import { planWalkForward, sliceByTime } from '../backtest/walk-forward.js'
import { bootstrapLowerBound, sharpeStatistic, seededRng } from '../backtest/bootstrap.js'
import { checkMonotonicity } from '../backtest/monotonicity.js'
import { evaluateGates, allGatesPass, type GateResult } from '../backtest/gates.js'
import { classifyRegimeSeries } from '../regime/regime-classifier.js'
import { trendFollowingStrategy } from '../strategies/trend-following.js'
import { meanReversionStrategy } from '../strategies/mean-reversion.js'
import { breakoutStrategy } from '../strategies/breakout.js'
import { momentumStrategy } from '../strategies/momentum.js'
import { regimeSwitchStrategy } from '../strategies/regime-switch.js'
import type { Strategy } from '../strategies/types.js'
import type { BacktestTrade } from '../backtest/types.js'

const COSTS = { commissionBps: 6, slippageBps: 5 }
const RISK_PCT = 0.01
const STARTING_EQUITY = 100_000
const WARMUP_BARS = 100
const BONFERRONI_N = 92
const FROZEN_AT = '2026-10-01T00:00:00.000Z'

interface GridCombo {
  strategyId: string
  strategy: Strategy
  version: string
  params: Record<string, unknown>
  axisCoords: number[]
}

function trendFollowingGrid(): GridCombo[] {
  const fastSlow: Array<[number, number]> = [[10, 30], [5, 20], [20, 50]]
  const atrMult = [2, 3]
  const combos: GridCombo[] = []
  fastSlow.forEach(([fastPeriod, slowPeriod], i) => atrMult.forEach((atrStopMultiplier, j) => {
    combos.push({ strategyId: 'trend-following', strategy: trendFollowingStrategy, version: trendFollowingStrategy.version, params: { fastPeriod, slowPeriod, atrPeriod: 14, atrStopMultiplier }, axisCoords: [i, j] })
  }))
  return combos
}
function meanReversionGrid(): GridCombo[] {
  const rsiPeriods = [10, 14]
  const obOs: Array<[number, number]> = [[30, 70], [20, 80]]
  const combos: GridCombo[] = []
  rsiPeriods.forEach((rsiPeriod, i) => obOs.forEach(([oversold, overbought], j) => {
    combos.push({ strategyId: 'mean-reversion', strategy: meanReversionStrategy, version: meanReversionStrategy.version, params: { rsiPeriod, oversold, overbought, exitMid: 50, stopPct: 0.02 }, axisCoords: [i, j] })
  }))
  return combos
}
function breakoutGrid(): GridCombo[] {
  const lookbacks = [10, 20, 55]
  const stopBuffers = [0.005, 0.01]
  const combos: GridCombo[] = []
  lookbacks.forEach((lookback, i) => stopBuffers.forEach((stopBufferPct, j) => {
    combos.push({ strategyId: 'breakout', strategy: breakoutStrategy, version: breakoutStrategy.version, params: { lookback, stopBufferPct }, axisCoords: [i, j] })
  }))
  return combos
}
function momentumGrid(): GridCombo[] {
  const periods = [10, 20]
  const thresholds = [0.03, 0.05]
  const combos: GridCombo[] = []
  periods.forEach((period, i) => thresholds.forEach((threshold, j) => {
    combos.push({ strategyId: 'momentum', strategy: momentumStrategy, version: momentumStrategy.version, params: { period, threshold, stopPct: 0.03, timeStopBars: 20 }, axisCoords: [i, j] })
  }))
  return combos
}
function regimeSwitchGrid(): GridCombo[] {
  const adxThresholds = [20, 25, 30]
  return adxThresholds.map((adxThreshold, i) => ({
    strategyId: 'regime-switch', strategy: regimeSwitchStrategy, version: regimeSwitchStrategy.version,
    params: { adxPeriod: 14, adxThreshold }, axisCoords: [i],
  }))
}

function fullGrid(): GridCombo[] {
  return [...trendFollowingGrid(), ...meanReversionGrid(), ...breakoutGrid(), ...momentumGrid(), ...regimeSwitchGrid()]
}

function isNeighbor(a: GridCombo, b: GridCombo): boolean {
  if (a.strategyId !== b.strategyId || a.axisCoords.length !== b.axisCoords.length) return false
  let diffCount = 0
  for (let k = 0; k < a.axisCoords.length; k++) {
    const d = Math.abs(a.axisCoords[k]! - b.axisCoords[k]!)
    if (d === 0) continue
    if (d !== 1) return false
    diffCount++
  }
  return diffCount === 1
}

interface VariantResult {
  strategyId: string
  version: string
  params: Record<string, unknown>
  symbol: string
  interval: '1h' | '4h'
  frozenAt: string
  wf: { trades: number; metrics: TradeMetrics; gates: GateResult[]; passed: boolean }
  holdout?: { trades: number; metrics: TradeMetrics; gates: GateResult[]; passed: boolean }
  buyAndHold: { totalReturnPct: number; maxDrawdownPct: number; sharpeAnnualized: number }
  funding: { scenario0: number; scenario5bps: number; scenario10bps: number }
}

function runOnWindow(combo: GridCombo, bars: Bar[], interval: '1h' | '4h', windowStart: Date, windowEnd: Date): BacktestTrade[] {
  const warmupMs = WARMUP_BARS * (interval === '1h' ? 3_600_000 : 4 * 3_600_000)
  const extendedStart = new Date(windowStart.getTime() - warmupMs)
  const windowBars = sliceByTime(bars, extendedStart, windowEnd)
  if (windowBars.length < 10) return []
  const result = runBacktest({ bars: windowBars, strategy: combo.strategy, params: combo.params, costs: COSTS, riskPct: RISK_PCT, startingEquity: STARTING_EQUITY }, interval)
  return result.trades.filter((t) => t.entryTime.getTime() >= windowStart.getTime())
}

function buyAndHoldStats(bars: Bar[]): { totalReturnPct: number; maxDrawdownPct: number; sharpeAnnualized: number } {
  if (bars.length < 2) return { totalReturnPct: 0, maxDrawdownPct: 0, sharpeAnnualized: 0 }
  const closes = bars.map((b) => Number(b.close))
  const totalReturnPct = ((closes[closes.length - 1]! / closes[0]!) - 1) * 100
  let peak = closes[0]!, maxDd = 0
  const rets: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (closes[i]! > peak) peak = closes[i]!
    maxDd = Math.max(maxDd, (peak - closes[i]!) / peak)
    if (i > 0) rets.push(closes[i]! / closes[i - 1]! - 1)
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1))
  const barsPerYear = (365 * 24 * 3_600_000) / (bars[1]!.timestamp.getTime() - bars[0]!.timestamp.getTime())
  return { totalReturnPct, maxDrawdownPct: maxDd * 100, sharpeAnnualized: sd > 0 ? (mean / sd) * Math.sqrt(barsPerYear) : 0 }
}

/** ADR-0011 §3 sensitivity — constant funding bps/day on open-position notional, applied to each trade's holding period, never a gate. */
function fundingSensitivity(trades: BacktestTrade[], bpsPerDay: number): number {
  return trades.reduce((sum, t) => {
    const days = Math.max(0, (t.exitTime.getTime() - t.entryTime.getTime()) / 86_400_000)
    const notional = t.entryPrice * t.qty
    return sum - notional * (bpsPerDay / 10_000) * days
  }, 0)
}

function evaluateVariant(combo: GridCombo, trades: BacktestTrade[], regimeTransitions: number, isLowFrequency: boolean): { metrics: TradeMetrics; gates: GateResult[]; passed: boolean } {
  const equityCurve: Array<{ time: Date; equity: number }> = [{ time: trades[0]?.entryTime ?? new Date(0), equity: STARTING_EQUITY }]
  let eq = STARTING_EQUITY
  for (const t of trades) { eq += t.pnl; equityCurve.push({ time: t.exitTime, equity: eq }) }
  const tradesPerYear = trades.length > 1
    ? trades.length / Math.max(1 / 365, (trades[trades.length - 1]!.exitTime.getTime() - trades[0]!.entryTime.getTime()) / (365 * 86_400_000))
    : 0
  const metrics = computeMetrics(trades, equityCurve, tradesPerYear)
  const expectancyLB = bootstrapLowerBound(trades.map((t) => t.pnlR), { iterations: 2000, lowerPercentile: 2.5, rng: seededRng(1) })
  const tradeReturns = trades.map((t) => t.pnl / STARTING_EQUITY)
  const sharpeAdjPercentile = (0.05 / BONFERRONI_N) * 100
  const sharpeLB = bootstrapLowerBound(tradeReturns, { iterations: 2000, lowerPercentile: sharpeAdjPercentile, rng: seededRng(2) }, sharpeStatistic) * Math.sqrt(tradesPerYear || 1)
  const monotonicity = checkMonotonicity(trades)
  const gates = evaluateGates({
    metrics, isLowFrequency, regimeTransitionsInOOS: regimeTransitions,
    bootstrapExpectancyLowerBound: Number.isFinite(expectancyLB) ? expectancyLB : -1,
    bootstrapSharpeLowerBoundAdjusted: Number.isFinite(sharpeLB) ? sharpeLB : -1,
    neighborSharpes: [], monotonicity,
  })
  return { metrics, gates, passed: allGatesPass(gates) }
}

async function main(): Promise<void> {
  const dbPath = process.argv[2] ?? resolve(import.meta.dirname, '../../data/backtest.db')
  const outPath = process.argv[3] ?? resolve(import.meta.dirname, '../../data/backtest-results.json')
  const db = openDatabase(dbPath)

  const symbols: Array<{ label: string; aliceId: string }> = [
    { label: 'BTC/USDT:USDT', aliceId: 'bybit-readonly|BTC/USDT:USDT' },
    { label: 'ETH/USDT:USDT', aliceId: 'bybit-readonly|ETH/USDT:USDT' },
  ]
  const intervals: Array<'1h' | '4h'> = ['1h', '4h']
  const grid = fullGrid()
  console.log(`[grid] ${grid.length} combinaciones x ${symbols.length} activos x ${intervals.length} intervalos = ${grid.length * symbols.length * intervals.length} variantes`)

  const results: VariantResult[] = []

  for (const symbol of symbols) {
    for (const interval of intervals) {
      const bars = readBars(db, 'bybit-readonly', symbol.aliceId, interval)
      if (bars.length === 0) { console.error(`[grid] NO ENCONTRADO: sin velas para ${symbol.aliceId} ${interval}`); continue }
      const plan = planWalkForward(bars)
      console.log(`[grid] ${symbol.label} ${interval}: ${bars.length} velas, ${plan.folds.length} folds WF, holdout desde ${plan.holdoutStart.toISOString()}`)
      const regimeSeries = classifyRegimeSeries(bars, 14, 25)
      const bAh = buyAndHoldStats(sliceByTime(bars, plan.folds[0]?.isStart ?? bars[0]!.timestamp, plan.holdoutStart))

      const byStrategy = new Map<string, GridCombo[]>()
      for (const combo of grid) {
        if (!byStrategy.has(combo.strategyId)) byStrategy.set(combo.strategyId, [])
        byStrategy.get(combo.strategyId)!.push(combo)
      }

      for (const combo of grid) {
        const oosTrades: BacktestTrade[] = []
        for (const fold of plan.folds) {
          oosTrades.push(...runOnWindow(combo, bars, interval, fold.oosStart, fold.oosEnd))
        }
        const oosBarsForRegime = sliceByTime(bars, plan.folds[0]?.oosStart ?? bars[0]!.timestamp, plan.holdoutStart)
        let transitions = 0
        const idxStart = bars.findIndex((b) => b.timestamp.getTime() === oosBarsForRegime[0]?.timestamp.getTime())
        if (idxStart >= 0) {
          for (let k = idxStart + 1; k < idxStart + oosBarsForRegime.length; k++) {
            if (regimeSeries[k] !== regimeSeries[k - 1] && regimeSeries[k] !== 'unknown' && regimeSeries[k - 1] !== 'unknown') transitions++
          }
        }
        const weeks = Math.max(1, (plan.holdoutStart.getTime() - (plan.folds[0]?.oosStart.getTime() ?? 0)) / (7 * 86_400_000))
        const isLowFrequency = oosTrades.length / weeks < 1

        const wf = evaluateVariant(combo, oosTrades, transitions, isLowFrequency)

        const variant: VariantResult = {
          strategyId: combo.strategyId, version: combo.version, params: combo.params,
          symbol: symbol.label, interval, frozenAt: FROZEN_AT,
          wf: { trades: oosTrades.length, metrics: wf.metrics, gates: wf.gates, passed: wf.passed },
          buyAndHold: bAh,
          funding: {
            scenario0: oosTrades.reduce((s, t) => s + t.pnl, 0),
            scenario5bps: oosTrades.reduce((s, t) => s + t.pnl, 0) + fundingSensitivity(oosTrades, 5),
            scenario10bps: oosTrades.reduce((s, t) => s + t.pnl, 0) + fundingSensitivity(oosTrades, 10),
          },
        }
        results.push(variant)
      }

      // Second pass: stability gate (G6) needs sibling results — recompute gates for each combo with real neighbor Sharpes.
      const stratResults = results.filter((r) => r.symbol === symbol.label && r.interval === interval)
      const resultByParams = new Map<string, VariantResult>(stratResults.map((r) => [`${r.strategyId}|${JSON.stringify(r.params)}`, r]))
      for (const r of stratResults) {
        const combo = grid.find((c) => c.strategyId === r.strategyId && JSON.stringify(c.params) === JSON.stringify(r.params))!
        const siblings = byStrategy.get(r.strategyId)!
        const neighborSharpes = siblings
          .filter((s) => isNeighbor(combo, s))
          .map((s) => resultByParams.get(`${s.strategyId}|${JSON.stringify(s.params)}`))
          .filter((n): n is VariantResult => Boolean(n))
          .map((n) => n.wf.metrics.sharpeAnnualized)
        if (neighborSharpes.length > 0) {
          const g6Idx = r.wf.gates.findIndex((g) => g.code === 'G6')
          const within = neighborSharpes.every((s) => Math.abs(s - r.wf.metrics.sharpeAnnualized) <= Math.abs(r.wf.metrics.sharpeAnnualized) * 0.2)
          r.wf.gates[g6Idx] = { code: 'G6', label: 'estabilidad ±20% en parámetros', status: within ? 'pass' : 'fail', detail: `vecinos: [${neighborSharpes.map((s) => s.toFixed(3)).join(', ')}] vs ${r.wf.metrics.sharpeAnnualized.toFixed(3)}` }
          r.wf.passed = allGatesPass(r.wf.gates)
        }
      }

      // Holdout — only for combos that passed ALL WF gates, once.
      for (const r of results.filter((x) => x.symbol === symbol.label && x.interval === interval && x.wf.passed)) {
        const combo = grid.find((c) => c.strategyId === r.strategyId && JSON.stringify(c.params) === JSON.stringify(r.params))!
        const holdoutTrades = runOnWindow(combo, bars, interval, plan.holdoutStart, plan.holdoutEnd)
        const holdoutRegimeBars = sliceByTime(bars, plan.holdoutStart, plan.holdoutEnd)
        let htrans = 0
        const hStart = bars.findIndex((b) => b.timestamp.getTime() === holdoutRegimeBars[0]?.timestamp.getTime())
        if (hStart >= 0) for (let k = hStart + 1; k < hStart + holdoutRegimeBars.length; k++) {
          if (regimeSeries[k] !== regimeSeries[k - 1] && regimeSeries[k] !== 'unknown' && regimeSeries[k - 1] !== 'unknown') htrans++
        }
        const hWeeks = Math.max(1, (plan.holdoutEnd.getTime() - plan.holdoutStart.getTime()) / (7 * 86_400_000))
        const hLowFreq = holdoutTrades.length / hWeeks < 1
        const holdoutEval = evaluateVariant(combo, holdoutTrades, htrans, hLowFreq)
        r.holdout = { trades: holdoutTrades.length, metrics: holdoutEval.metrics, gates: holdoutEval.gates, passed: holdoutEval.passed }
      }

      console.log(`[grid] ${symbol.label} ${interval}: ${stratResults.filter((r) => r.wf.passed).length}/${stratResults.length} pasaron WF; ${stratResults.filter((r) => r.holdout?.passed).length} pasaron holdout también`)
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\n[grid] done — ${results.length} variantes evaluadas, resultados en ${outPath}`)
}

main().catch((err) => {
  console.error('[grid] fatal:', err)
  process.exit(1)
})
