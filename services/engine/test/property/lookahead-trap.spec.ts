import { describe, expect, it } from 'vitest'
import { lookaheadTrapStrategy } from './lookahead-trap-strategy.js'
import { assertNoLookahead } from '../../src/strategies/purity-helpers.js'
import { trendFollowingStrategy } from '../../src/strategies/trend-following.js'
import { meanReversionStrategy } from '../../src/strategies/mean-reversion.js'
import { breakoutStrategy } from '../../src/strategies/breakout.js'
import { momentumStrategy } from '../../src/strategies/momentum.js'
import { regimeSwitchStrategy } from '../../src/strategies/regime-switch.js'
import { risingBars, oscillatingBars } from '../../src/strategies/test-fixtures.js'
import type { Strategy } from '../../src/strategies/types.js'

/**
 * Mutation test for the no-lookahead property itself. Per
 * PROMPT_MASTER_CLAUDE_CODE.md §37 F3 ("no-lookahead") plus an explicit
 * request to prove the assertion has teeth, not just pass by construction.
 *
 * Two full histories that agree up to index k=20 and diverge after it:
 * fullA's bar 20 closes LOW, fullB's bar 20 closes HIGH.
 */
const fullA = risingBars(40)
const fullB = fullA.map((b, i) => (i === 20 ? { ...b, close: '0.01', open: '0.01', high: '0.01', low: '0.01' } : b))
const K = 20

describe('no-lookahead mutation test', () => {
  it('the trap strategy DOES see the future (sanity check on the trap itself)', () => {
    // Not using assertNoLookahead here — calling evaluate() directly, with
    // exactly the bait shape assertNoLookahead constructs internally
    // (bait = full.slice(K), so bait[0] is the bar immediately after the
    // truncated "today" = bars[K-1]), to show the trap produces genuinely
    // different decisions depending on which "future" it's handed.
    const seesFullANaturalContinuation = lookaheadTrapStrategy.evaluate({
      bars: fullA.slice(0, K),
      interval: '1d',
      params: { __noLookaheadBaitFutureBars: fullA.slice(K) }, // real next bar: rising series, higher close
    })
    const seesFullBLoweredContinuation = lookaheadTrapStrategy.evaluate({
      bars: fullB.slice(0, K), // identical prefix to fullA up to K (fullA/fullB only diverge AT K)
      interval: '1d',
      params: { __noLookaheadBaitFutureBars: fullB.slice(K) }, // fullB's bar K was forced down to 0.01
    })
    expect(seesFullANaturalContinuation.kind).toBe('ENTER') // rising series: tomorrow > today
    expect(seesFullBLoweredContinuation.kind).toBe('NONE') // told tomorrow crashes to 0.01: not > today
  })

  it('assertNoLookahead FAILS (throws) against the trap strategy', () => {
    expect(() => assertNoLookahead(lookaheadTrapStrategy, fullA, fullB, K, {})).toThrow()
  })

  it.each<[string, Strategy, unknown]>([
    ['trend-following', trendFollowingStrategy, { fastPeriod: 5, slowPeriod: 15, atrPeriod: 14, atrStopMultiplier: 2 }],
    ['mean-reversion', meanReversionStrategy, { rsiPeriod: 14, oversold: 30, overbought: 70, exitMid: 50, stopPct: 0.02 }],
    ['breakout', breakoutStrategy, { lookback: 10, stopBufferPct: 0.005 }],
    ['momentum', momentumStrategy, { period: 10, threshold: 0.02, stopPct: 0.03, timeStopBars: 20 }],
  ])('assertNoLookahead PASSES for strategy %s (the same assertion the trap fails)', (_name, strategy, params) => {
    expect(() => assertNoLookahead(strategy, fullA, fullB, K, params)).not.toThrow()
  })

  it('assertNoLookahead PASSES for regime-switch (E) on an oscillating fixture', () => {
    const oscA = oscillatingBars(100)
    const oscB = oscA.map((b, i) => (i === 40 ? { ...b, close: '1.23' } : b))
    const params = {
      adxPeriod: 14,
      adxThreshold: 25,
      trending: { fastPeriod: 5, slowPeriod: 15, atrPeriod: 14, atrStopMultiplier: 2 },
      ranging: { rsiPeriod: 14, oversold: 30, overbought: 70, exitMid: 50, stopPct: 0.02 },
    }
    expect(() => assertNoLookahead(regimeSwitchStrategy, oscA, oscB, 40, params)).not.toThrow()
  })
})
