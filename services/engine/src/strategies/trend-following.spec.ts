import { describe, expect, it } from 'vitest'
import { trendFollowingStrategy } from './trend-following.js'
import { vShapedBars, flatBars, perfectlyFlatBars } from './test-fixtures.js'
import { assertPure, assertDeterministic, assertNoLookahead, walkForward } from './purity-helpers.js'
import { DEGENERATE_INPUT } from './guards.js'
import type { StrategyDecision } from './types.js'

const params = { fastPeriod: 5, slowPeriod: 15, atrPeriod: 14, atrStopMultiplier: 2 }

describe('trendFollowingStrategy', () => {
  it('enters long with a stop below entry during the rising leg of a V', () => {
    const bars = vShapedBars(60)
    const decisions = walkForward(trendFollowingStrategy, bars, params, 16)
    const longEntry = decisions.find((d) => d.decision.kind === 'ENTER' && d.decision.side === 'long')
    expect(longEntry).toBeDefined()
    const decision = longEntry!.decision as Extract<StrategyDecision, { kind: 'ENTER' }>
    expect(decision.stop).toBeLessThan(decision.entry)
    expect(decision.score).toBeGreaterThanOrEqual(0)
    expect(decision.score).toBeLessThanOrEqual(1)
    expect(decision.reasonCodes).toContain('fast_sma_crossed_above_slow')
  })

  it('never enters on a flat series (no crossover possible)', () => {
    const decisions = walkForward(trendFollowingStrategy, flatBars(40), params, 16)
    expect(decisions.every((d) => d.decision.kind === 'NONE')).toBe(true)
  })

  it('refuses to enter when ATR is exactly 0 (a zero-width stop would trigger instantly)', () => {
    const decisions = walkForward(trendFollowingStrategy, perfectlyFlatBars(40), params, 16)
    const pastWarmup = decisions.filter((d) => d.index >= 16 + params.atrPeriod)
    expect(pastWarmup.length).toBeGreaterThan(0)
    for (const d of pastWarmup) {
      expect(d.decision.kind).toBe('NONE')
      expect((d.decision as { reasonCodes?: string[] }).reasonCodes).toContain(DEGENERATE_INPUT)
    }
  })

  it('is pure, deterministic, and does not look ahead', () => {
    const bars = vShapedBars(60)
    const ctx = { bars: bars.slice(0, 30), interval: '1d' as const, params }
    assertPure(trendFollowingStrategy, ctx)
    assertDeterministic(trendFollowingStrategy, ctx)

    const divergentTail = vShapedBars(60).map((b, i) => (i >= 30 ? { ...b, close: '9999.99' } : b))
    assertNoLookahead(trendFollowingStrategy, bars, divergentTail, 30, params)
  })
})
