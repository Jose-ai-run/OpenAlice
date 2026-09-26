import { describe, expect, it } from 'vitest'
import { meanReversionStrategy } from './mean-reversion.js'
import { oscillatingBars, flatBars } from './test-fixtures.js'
import { assertPure, assertDeterministic, assertNoLookahead, walkForward } from './purity-helpers.js'

const params = { rsiPeriod: 14, oversold: 30, overbought: 70, exitMid: 50, stopPct: 0.02 }

describe('meanReversionStrategy', () => {
  it('enters both long (oversold) and short (overbought) across an oscillating series', () => {
    const bars = oscillatingBars(100)
    // This fixture's RSI(14) empirically ranges ~[32.4, 74.2] (verified by
    // computing rsiSeries directly over the fixture) — asymmetric because
    // Wilder's initial-average window is not phase-aligned with the wave.
    // oversold needs to sit above 32.4 to ever trigger; overbought's
    // default (70) already works.
    const loosened = { ...params, oversold: 35 }
    const decisions = walkForward(meanReversionStrategy, bars, loosened, 15)
    const entries = decisions.filter((d) => d.decision.kind === 'ENTER')
    expect(entries.some((d) => (d.decision as { side: string }).side === 'long')).toBe(true)
    expect(entries.some((d) => (d.decision as { side: string }).side === 'short')).toBe(true)
    for (const e of entries) {
      const d = e.decision as Extract<typeof e.decision, { kind: 'ENTER' }>
      expect(d.score).toBeGreaterThanOrEqual(0)
      expect(d.score).toBeLessThanOrEqual(1)
      if (d.side === 'long') expect(d.stop).toBeLessThan(d.entry)
      else expect(d.stop).toBeGreaterThan(d.entry)
    }
  })

  it('on a perfectly flat series, RSI is degenerate (100, not 50 — zero losses divides specially, matching src/domain/analysis/indicator/functions/technical.ts RSI()): enters short exactly once, then holds forever', () => {
    const decisions = walkForward(meanReversionStrategy, flatBars(40), params, 15)
    const entries = decisions.filter((d) => d.decision.kind === 'ENTER')
    expect(entries).toHaveLength(1)
    expect((entries[0]!.decision as { side: string }).side).toBe('short')
    const afterEntry = decisions.slice(decisions.indexOf(entries[0]!) + 1)
    expect(afterEntry.every((d) => d.decision.kind === 'NONE')).toBe(true)
  })

  it('is pure, deterministic, and does not look ahead', () => {
    const bars = oscillatingBars(100)
    const ctx = { bars: bars.slice(0, 40), interval: '1d' as const, params }
    assertPure(meanReversionStrategy, ctx)
    assertDeterministic(meanReversionStrategy, ctx)

    const divergentTail = oscillatingBars(100).map((b, i) => (i >= 40 ? { ...b, close: '1.23' } : b))
    assertNoLookahead(meanReversionStrategy, bars, divergentTail, 40, params)
  })
})
