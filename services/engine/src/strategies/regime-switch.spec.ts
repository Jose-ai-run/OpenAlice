import { describe, expect, it } from 'vitest'
import { regimeSwitchStrategy } from './regime-switch.js'
import { vShapedBars, oscillatingBars, flatBars } from './test-fixtures.js'
import { assertPure, assertDeterministic, assertNoLookahead, walkForward } from './purity-helpers.js'

const params = {
  adxPeriod: 14,
  adxThreshold: 25,
  trending: { fastPeriod: 5, slowPeriod: 15, atrPeriod: 14, atrStopMultiplier: 2 },
  ranging: { rsiPeriod: 14, oversold: 30, overbought: 70, exitMid: 50, stopPct: 0.02 },
}

describe('regimeSwitchStrategy', () => {
  it('tags every decision with the regime that produced it', () => {
    const bars = vShapedBars(80)
    const decisions = walkForward(regimeSwitchStrategy, bars, params, 30)
    const entries = decisions.filter((d) => d.decision.kind === 'ENTER' || d.decision.kind === 'EXIT')
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      const d = e.decision as { reasonCodes: string[] }
      expect(d.reasonCodes.some((r) => r.startsWith('regime:'))).toBe(true)
    }
  })

  it('on a flat series, ADX is near-zero -> ranging -> delegates to mean-reversion, which is itself degenerate on flat data (see mean-reversion.spec.ts): at most one entry, then holds', () => {
    const decisions = walkForward(regimeSwitchStrategy, flatBars(50), params, 30)
    const entries = decisions.filter((d) => d.decision.kind === 'ENTER')
    expect(entries.length).toBeLessThanOrEqual(1)
    if (entries.length === 1) {
      const afterEntry = decisions.slice(decisions.indexOf(entries[0]!) + 1)
      expect(afterEntry.every((d) => d.decision.kind === 'NONE')).toBe(true)
    }
  })

  it('is pure, deterministic, and does not look ahead', () => {
    const bars = oscillatingBars(100)
    const ctx = { bars: bars.slice(0, 40), interval: '1d' as const, params }
    assertPure(regimeSwitchStrategy, ctx)
    assertDeterministic(regimeSwitchStrategy, ctx)

    const divergentTail = oscillatingBars(100).map((b, i) => (i >= 40 ? { ...b, close: '1.23' } : b))
    assertNoLookahead(regimeSwitchStrategy, bars, divergentTail, 40, params)
  })
})
