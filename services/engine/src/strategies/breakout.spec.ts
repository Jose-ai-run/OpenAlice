import { describe, expect, it } from 'vitest'
import { breakoutStrategy } from './breakout.js'
import { risingBars, flatBars, perfectlyFlatBars } from './test-fixtures.js'
import { assertPure, assertDeterministic, assertNoLookahead, walkForward } from './purity-helpers.js'
import { DEGENERATE_INPUT } from './guards.js'
import type { StrategyDecision } from './types.js'

const params = { lookback: 10, stopBufferPct: 0.005 }

describe('breakoutStrategy', () => {
  it('enters long once the close breaks above the prior lookback high', () => {
    const bars = risingBars(40)
    const decisions = walkForward(breakoutStrategy, bars, params, 10)
    const longEntry = decisions.find((d) => d.decision.kind === 'ENTER')
    expect(longEntry).toBeDefined()
    const decision = longEntry!.decision as Extract<StrategyDecision, { kind: 'ENTER' }>
    expect(decision.side).toBe('long')
    expect(decision.stop).toBeLessThan(decision.entry)
    expect(decision.reasonCodes).toContain('closed_above_prior_high')
  })

  it('never enters on a flat series (nothing to break out of)', () => {
    const decisions = walkForward(breakoutStrategy, flatBars(30), params, 10)
    expect(decisions.every((d) => d.decision.kind === 'NONE')).toBe(true)
  })

  it('refuses to signal on a zero-range prior window (any move would trivially "break out")', () => {
    const decisions = walkForward(breakoutStrategy, perfectlyFlatBars(30), params, 10)
    const pastWarmup = decisions.filter((d) => d.index >= params.lookback)
    expect(pastWarmup.length).toBeGreaterThan(0)
    for (const d of pastWarmup) {
      expect(d.decision.kind).toBe('NONE')
      expect((d.decision as { reasonCodes?: string[] }).reasonCodes).toContain(DEGENERATE_INPUT)
    }
  })

  it('is pure, deterministic, and does not look ahead', () => {
    const bars = risingBars(40)
    const ctx = { bars: bars.slice(0, 25), interval: '1d' as const, params }
    assertPure(breakoutStrategy, ctx)
    assertDeterministic(breakoutStrategy, ctx)

    const divergentTail = risingBars(40).map((b, i) => (i >= 25 ? { ...b, close: '0.01' } : b))
    assertNoLookahead(breakoutStrategy, bars, divergentTail, 25, params)
  })
})
