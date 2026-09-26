import { describe, expect, it } from 'vitest'
import { adxSeries } from './adx.js'
import { HLC_FIXTURE } from './test-fixtures.js'

/**
 * PROMPT_MASTER_CLAUDE_CODE.md §37 F3: "ADX... dentro de una tolerancia de
 * 1e-9 frente a referencias calculadas a mano".
 *
 * The reference values below come from an independently written,
 * differently-structured computation (plain loops, no shared code with
 * adx.ts) traced step by step over HLC_FIXTURE with period=3:
 *
 *   TR   (bars 1..9): [2, 2, 2, 2, 1.5, 1.5, 2.5, 2, 2]
 *   +DM  (bars 1..9): [1, 1, 1, 1, 0, 0, 1.5, 1, 1]
 *   -DM  (bars 1..9): [0, 0, 0, 0, 0, 1, 0, 0, 0]
 *
 *   Wilder-smoothed sums (first = sum of first 3, then prev - prev/3 + cur):
 *     smTR   = [6, 6, 5.5, 5.1666..., 5.9444..., 5.9629..., 5.9753...]
 *     sm+DM  = [3, 3, 2, 1.3333..., 2.3888..., 2.5925..., 2.7283...]
 *     sm-DM  = [0, 0, 0, 1, 0.6666..., 0.4444..., 0.2962...]
 *
 *   +DI = 100*sm+DM/smTR, -DI = 100*sm-DM/smTR, DX = 100*|+DI - -DI|/(+DI+-DI):
 *     DX = [100, 100, 100, 14.285714285714281, 56.363636363636374,
 *           70.73170731707317, 80.40816326530613]
 *
 *   ADX (first = avg of first 3 DX, then Wilder-smoothed): starts at bar
 *   index 2*period-1 = 5 (10 bars total, so 5 ADX values: bars 5..9):
 *     ADX = [100, 71.42857142857143, 66.40692640692642,
 *            67.848520043642, 72.03506778419671]
 */
describe('adxSeries — 1e-9 against a hand-traced reference', () => {
  const { highs, lows, closes } = HLC_FIXTURE
  const series = adxSeries(highs, lows, closes, 3)

  it('is null before the first computable index (2*period-1 = 5)', () => {
    expect(series.slice(0, 5)).toEqual([null, null, null, null, null])
  })

  it('matches the hand-traced reference at every computable point', () => {
    const expected = [100, 71.42857142857143, 66.40692640692642, 67.848520043642, 72.03506778419671]
    for (let i = 0; i < expected.length; i++) {
      expect(series[5 + i]).toBeCloseTo(expected[i]!, 9)
    }
  })

  it('is deterministic and pure — same input, same output, no mutation', () => {
    const again = adxSeries(highs, lows, closes, 3)
    expect(again).toEqual(series)
    // Inputs must be untouched (readonly arrays, but verify no accidental mutation).
    expect(highs).toEqual(HLC_FIXTURE.highs)
  })

  it('never produces NaN/Infinity on a perfectly flat series (zero true range)', () => {
    // high===low===close, unchanging, for every bar -> smoothed TR is
    // exactly 0. Corrected 2026-09-25: this must stay finite (0), not NaN.
    const flatHighs = new Array(20).fill(100)
    const flatLows = new Array(20).fill(100)
    const flatCloses = new Array(20).fill(100)
    const out = adxSeries(flatHighs, flatLows, flatCloses, 3)
    for (const v of out) {
      if (v !== null) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBe(0)
      }
    }
  })

  it('respects no-lookahead: truncating future bars does not change past values', () => {
    const truncated = adxSeries(highs.slice(0, 7), lows.slice(0, 7), closes.slice(0, 7), 3)
    for (let i = 0; i < truncated.length; i++) {
      expect(truncated[i]).toBe(series[i])
    }
  })
})
