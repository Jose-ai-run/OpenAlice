import { describe, expect, it } from 'vitest'
import { momentumStrategy } from './momentum.js'
import { risingBars, flatBars } from './test-fixtures.js'
import { assertPure, assertDeterministic, assertNoLookahead, walkForward } from './purity-helpers.js'
import { DEGENERATE_INPUT } from './guards.js'
import type { Bar } from '@traderalice/uta-protocol'
import type { StrategyDecision } from './types.js'

const params = { period: 10, threshold: 0.02, stopPct: 0.03, timeStopBars: 20 }

describe('momentumStrategy', () => {
  it('enters long once ROC clears the threshold on a rising series', () => {
    const bars = risingBars(40)
    const decisions = walkForward(momentumStrategy, bars, params, 10)
    const longEntry = decisions.find((d) => d.decision.kind === 'ENTER')
    expect(longEntry).toBeDefined()
    const decision = longEntry!.decision as Extract<StrategyDecision, { kind: 'ENTER' }>
    expect(decision.side).toBe('long')
    expect(decision.timeStopBars).toBe(20)
    expect(decision.reasonCodes).toContain('roc_above_threshold')
  })

  it('never enters on a flat series (ROC stays at 0)', () => {
    const decisions = walkForward(momentumStrategy, flatBars(30), params, 10)
    expect(decisions.every((d) => d.decision.kind === 'NONE')).toBe(true)
  })

  it('refuses to compute ROC against a zero reference price rather than dividing by zero', () => {
    const bars: Bar[] = risingBars(15).map((b, i) =>
      i === 0 ? { ...b, close: '0', open: '0', high: '0', low: '0' } : b,
    )
    const decision = momentumStrategy.evaluate({ bars: bars.slice(0, 11), interval: '1d', params })
    expect(decision.kind).toBe('NONE')
    expect((decision as { reasonCodes?: string[] }).reasonCodes).toContain(DEGENERATE_INPUT)
    expect((decision as { reasonCodes?: string[] }).reasonCodes).toContain('zero_reference_price')
  })

  it('is pure, deterministic, and does not look ahead', () => {
    const bars = risingBars(40)
    const ctx = { bars: bars.slice(0, 25), interval: '1d' as const, params }
    assertPure(momentumStrategy, ctx)
    assertDeterministic(momentumStrategy, ctx)

    const divergentTail = risingBars(40).map((b, i) => (i >= 25 ? { ...b, close: '0.01' } : b))
    assertNoLookahead(momentumStrategy, bars, divergentTail, 25, params)
  })
})
