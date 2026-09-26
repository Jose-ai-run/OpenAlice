import { describe, expect, it } from 'vitest'
import type { Bar } from '@traderalice/uta-protocol'
import { buildStrategyContext } from './context-builder.js'

function bar(day: number, close: number): Bar {
  return {
    timestamp: new Date(Date.UTC(2026, 0, day)),
    open: close.toFixed(2),
    high: close.toFixed(2),
    low: close.toFixed(2),
    close: close.toFixed(2),
    volume: '1000',
  }
}

describe('buildStrategyContext — THE real no-lookahead guarantee', () => {
  it('never includes bars timestamped after asOf, even when the raw dataset contains them', () => {
    const asOf = new Date(Date.UTC(2026, 0, 10)) // day 10, exactly at its open (a '1d' bar closes 24h later)
    const raw: Bar[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((d) => bar(d, 100))
    // asOf sits exactly at day 10's open, so day 10 itself has not closed yet either —
    // this single fixture exercises BOTH guarantees at once (see the next test for
    // open-candle-only in isolation).
    const ctx = buildStrategyContext({ bars: raw, interval: '1d', asOf, params: {} })
    expect(ctx.bars.every((b) => b.timestamp.getTime() < asOf.getTime())).toBe(true)
    expect(ctx.bars).toHaveLength(9) // days 1-9 only: day 10 hasn't closed, days 11-12 are future
  })

  it('excludes the trailing bar specifically when it has not closed by asOf, independent of future bars', () => {
    const asOf = new Date(Date.UTC(2026, 0, 9, 12)) // mid-day-9, day 9's bar (opens day 9 00:00) hasn't closed
    const raw: Bar[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => bar(d, 100))
    const ctx = buildStrategyContext({ bars: raw, interval: '1d', asOf, params: {} })
    expect(ctx.bars).toHaveLength(8) // day 9 excluded — still forming at asOf
  })

  it('includes every closed bar up to and including one that closes exactly at asOf', () => {
    const asOf = new Date(Date.UTC(2026, 0, 10)) // exactly day 9's close (day 9 opens day 8 00:00... use day 9 bar opening day 9, closing day 10)
    const raw: Bar[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => bar(d, 100))
    const ctx = buildStrategyContext({ bars: raw, interval: '1d', asOf, params: {} })
    expect(ctx.bars).toHaveLength(9) // day 9's bar (open day9 00:00, closes day10 00:00 = asOf) IS closed at asOf
  })
})

describe('Trap (a) — a real strategy fed leaked future bars decides differently than through the builder', () => {
  it('momentum sees a future price spike if the caller bypasses buildStrategyContext, but never if it goes through it', async () => {
    const { momentumStrategy } = await import('./momentum.js')
    const params = { period: 5, threshold: 0.05, stopPct: 0.03, timeStopBars: 20 }

    // Flat history through day 10 (closed) — no momentum signal.
    const visible: Bar[] = Array.from({ length: 10 }, (_, i) => bar(i + 1, 100))
    // "Future" data a buggy caller might still be holding a reference to
    // (e.g. it fetched a wider window and forgot to slice before calling
    // evaluate) — a sharp spike that WOULD trip the threshold.
    const future: Bar[] = [bar(11, 200), bar(12, 210)]
    const rawDataset = [...visible, ...future]
    const asOf = new Date(Date.UTC(2026, 0, 11)) // exactly day 10's close

    const leakedCtx = { bars: rawDataset, interval: '1d' as const, params } // bypasses the builder entirely
    const leaked = momentumStrategy.evaluate(leakedCtx)
    expect(leaked.kind).toBe('ENTER') // it used day 12's close as "today" — the leak

    const safeCtx = buildStrategyContext({ bars: rawDataset, interval: '1d', asOf, params })
    expect(safeCtx.bars).toHaveLength(10) // future bars never made it in
    const safe = momentumStrategy.evaluate(safeCtx)
    expect(safe.kind).toBe('NONE') // flat history through the real "today" — no signal
  })
})

describe('Trap (b) — a real strategy fed an unclosed "open candle" as if it were final', () => {
  it('momentum reacts to a still-forming candle when bypassing the builder, never when going through it', async () => {
    const { momentumStrategy } = await import('./momentum.js')
    const params = { period: 5, threshold: 0.05, stopPct: 0.03, timeStopBars: 20 }

    const closedHistory: Bar[] = Array.from({ length: 9 }, (_, i) => bar(i + 1, 100)) // days 1-9, all closed by asOf
    const stillForming = bar(10, 300) // day 10's candle — opened, but per asOf below has NOT closed; an extreme intra-bar print
    const rawDataset = [...closedHistory, stillForming]
    const asOf = new Date(Date.UTC(2026, 0, 10, 12)) // mid-day-10 — day 10 opened but will not close until day 11

    const leakedCtx = { bars: rawDataset, interval: '1d' as const, params } // treats the open candle as final
    const leaked = momentumStrategy.evaluate(leakedCtx)
    expect(leaked.kind).toBe('ENTER') // reacted to the unclosed 300 print

    const safeCtx = buildStrategyContext({ bars: rawDataset, interval: '1d', asOf, params })
    expect(safeCtx.bars).toHaveLength(9) // the open candle never made it in
    const safe = momentumStrategy.evaluate(safeCtx)
    expect(safe.kind).toBe('NONE') // flat closed history only
  })
})

describe('Trap (c) — a feature computed using bar t+1', () => {
  // A minimal, deliberately-broken feature — NOT one of the real
  // indicators-series functions (those are covered by their own
  // truncation tests: adx.spec.ts, rsi.spec.ts, sma.spec.ts, atr.spec.ts —
  // this is a fresh, easy-to-audit illustration of the same class of bug,
  // not a replacement for those).
  function buggyDelta(values: readonly number[], i: number): number {
    return values[i + 1]! - values[i]! // reads the NEXT value — the bug
  }
  function correctDelta(values: readonly number[], i: number): number {
    return i > 0 ? values[i]! - values[i - 1]! : NaN
  }

  it('the buggy feature is undefined/NaN under proper truncation but "works" when future data leaks in — proving it depends on t+1', () => {
    const values = [100, 101, 102, 103, 104, 105]
    const i = 3
    const truncated = values.slice(0, i + 1) // properly "as of" index i: nothing after it exists
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const buggyUnderTruncation = buggyDelta(truncated as number[], i)
    expect(Number.isNaN(buggyUnderTruncation)).toBe(true) // values[i+1] doesn't exist -> undefined - number = NaN

    const buggyWithFutureLeaked = buggyDelta(values, i) // full array "leaks" index i+1
    expect(Number.isNaN(buggyWithFutureLeaked)).toBe(false)
    expect(buggyWithFutureLeaked).toBe(1) // it computed something — using data from the future
  })

  it('the correct feature is identical whether or not future data is present (real no-lookahead)', () => {
    const values = [100, 101, 102, 103, 104, 105]
    const i = 3
    const truncated = values.slice(0, i + 1)
    expect(correctDelta(truncated, i)).toBe(correctDelta(values, i))
    expect(correctDelta(values, i)).toBe(1)
  })
})
