import { describe, expect, it } from 'vitest'
import type { Bar } from '@traderalice/uta-protocol'
import type { Strategy, StrategyDecision } from '../strategies/types.js'
import { runBacktest } from './engine.js'

function bar(hourOffset: number, o: number, h: number, l: number, c: number): Bar {
  const t = new Date(Date.UTC(2026, 0, 1, hourOffset))
  return { timestamp: t, open: String(o), high: String(h), low: String(l), close: String(c), volume: '1' }
}

const noCosts = { commissionBps: 0, slippageBps: 0 }

describe('runBacktest — fill model (ADR-0011 §3)', () => {
  it('enters at the OPEN of the bar AFTER the signal bar, never the signal bar itself', () => {
    const bars = [bar(0, 100, 101, 99, 100), bar(1, 105, 106, 104, 105), bar(2, 110, 111, 109, 110)]
    let signaled = false
    const strategy: Strategy = {
      id: 'test', version: '1', paramsSchema: {} as never, warmup: () => [],
      evaluate: (ctx): StrategyDecision => {
        if (!ctx.position && !signaled && ctx.bars.length === 1) {
          signaled = true
          return { kind: 'ENTER', side: 'long', entry: 100, stop: 90, score: 0.5, reasonCodes: [] }
        }
        return { kind: 'NONE' }
      },
    }
    const result = runBacktest({ bars, strategy, params: {}, costs: noCosts, riskPct: 0.01, startingEquity: 10_000 }, '1h')
    expect(result.trades).toHaveLength(1)
    expect(result.trades[0]!.entryPrice).toBe(105)  // open of bar(1), not bar(0)
  })

  it('stop wins when both stop and a signal_exit would trigger in the same bar (conservative tie-break)', () => {
    // Long entry stop=90. Bar after entry has low=85 (stop hit) — strategy
    // would also return EXIT that same bar, but the stop check runs first.
    const bars = [
      bar(0, 100, 101, 99, 100),
      bar(1, 100, 102, 98, 101),   // entry bar (open=100)
      bar(2, 101, 103, 85, 95),    // low=85 crosses stop=90
    ]
    const strategy: Strategy = {
      id: 'test', version: '1', paramsSchema: {} as never, warmup: () => [],
      evaluate: (ctx): StrategyDecision => {
        if (!ctx.position) return ctx.bars.length === 1 ? { kind: 'ENTER', side: 'long', entry: 100, stop: 90, score: 0.5, reasonCodes: [] } : { kind: 'NONE' }
        return { kind: 'EXIT', reasonCodes: ['would_exit_same_bar'] }
      },
    }
    const result = runBacktest({ bars, strategy, params: {}, costs: noCosts, riskPct: 0.01, startingEquity: 10_000 }, '1h')
    expect(result.trades).toHaveLength(1)
    expect(result.trades[0]!.exitReason).toBe('stop')
    expect(result.trades[0]!.exitPrice).toBe(90)  // exact stop level, not the bar's low
  })

  it('applies commission and slippage per side, reducing net PnL', () => {
    const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 110, 99, 105), bar(2, 105, 106, 104, 105)]
    const strategy: Strategy = {
      id: 'test', version: '1', paramsSchema: {} as never, warmup: () => [],
      evaluate: (ctx): StrategyDecision => {
        if (!ctx.position) return ctx.bars.length === 1 ? { kind: 'ENTER', side: 'long', entry: 100, stop: 90, score: 0.5, reasonCodes: [] } : { kind: 'NONE' }
        return { kind: 'EXIT', reasonCodes: ['done'] }
      },
    }
    const free = runBacktest({ bars, strategy, params: {}, costs: noCosts, riskPct: 0.01, startingEquity: 10_000 }, '1h')
    const costly = runBacktest({ bars, strategy, params: {}, costs: { commissionBps: 10, slippageBps: 10 }, riskPct: 0.01, startingEquity: 10_000 }, '1h')
    expect(costly.trades[0]!.pnl).toBeLessThan(free.trades[0]!.pnl)
  })

  it('a position still open at the end of data force-closes at the last bar close, reason end_of_data', () => {
    const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 102, 98, 101), bar(2, 101, 103, 100, 102)]
    const strategy: Strategy = {
      id: 'test', version: '1', paramsSchema: {} as never, warmup: () => [],
      evaluate: (ctx): StrategyDecision =>
        !ctx.position && ctx.bars.length === 1 ? { kind: 'ENTER', side: 'long', entry: 100, stop: 1, score: 0.5, reasonCodes: [] } : { kind: 'NONE' },
    }
    const result = runBacktest({ bars, strategy, params: {}, costs: noCosts, riskPct: 0.01, startingEquity: 10_000 }, '1h')
    expect(result.trades).toHaveLength(1)
    expect(result.trades[0]!.exitReason).toBe('end_of_data')
    expect(result.trades[0]!.exitPrice).toBe(102)  // close of the last bar
  })

  it('ADJUST_STOP only tightens — a long never gets a lower stop from it', () => {
    const bars = [
      bar(0, 100, 101, 99, 100),
      bar(1, 100, 102, 98, 101),
      bar(2, 101, 103, 95, 102),   // ADJUST_STOP tries to WIDEN to 80 — must be ignored
      bar(3, 102, 104, 92, 103),   // low=92 — would hit original stop=90? no. Then force end.
    ]
    const strategy: Strategy = {
      id: 'test', version: '1', paramsSchema: {} as never, warmup: () => [],
      evaluate: (ctx): StrategyDecision => {
        if (!ctx.position) return ctx.bars.length === 1 ? { kind: 'ENTER', side: 'long', entry: 100, stop: 90, score: 0.5, reasonCodes: [] } : { kind: 'NONE' }
        if (ctx.bars.length === 3) return { kind: 'ADJUST_STOP', newStop: 80 }  // widening attempt
        return { kind: 'NONE' }
      },
    }
    const result = runBacktest({ bars, strategy, params: {}, costs: noCosts, riskPct: 0.01, startingEquity: 10_000 }, '1h')
    expect(result.trades[0]!.exitReason).toBe('end_of_data')  // never stopped out at 90 or 80
  })

  it('skips a signal whose sizing falls below minQty rather than recording a zero-qty trade', () => {
    const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 101, 99, 100)]
    const strategy: Strategy = {
      id: 'test', version: '1', paramsSchema: {} as never, warmup: () => [],
      evaluate: (ctx): StrategyDecision =>
        !ctx.position && ctx.bars.length === 1 ? { kind: 'ENTER', side: 'long', entry: 100, stop: 1, score: 0.5, reasonCodes: [] } : { kind: 'NONE' },
    }
    // riskPerUnit = 99, riskAmount = 10000 * 1e-9 = 1e-5 -> rawQty ~1e-7, far below minQty=0.0001.
    const result = runBacktest({ bars, strategy, params: {}, costs: noCosts, riskPct: 1e-9, startingEquity: 10_000 }, '1h')
    expect(result.trades).toHaveLength(0)
  })
})
