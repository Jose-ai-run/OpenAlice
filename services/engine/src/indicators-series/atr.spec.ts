import { describe, expect, it } from 'vitest'
import { atrSeries } from './atr.js'
import { HLC_FIXTURE } from './test-fixtures.js'

describe('atrSeries', () => {
  it('is null before period+1 bars exist, then always positive', () => {
    const { highs, lows, closes } = HLC_FIXTURE
    const out = atrSeries(highs, lows, closes, 3)
    expect(out.slice(0, 3)).toEqual([null, null, null])
    for (const v of out.slice(3)) {
      expect(v).toBeGreaterThan(0)
    }
  })

  it('respects no-lookahead', () => {
    const { highs, lows, closes } = HLC_FIXTURE
    const full = atrSeries(highs, lows, closes, 3)
    const truncated = atrSeries(highs.slice(0, 7), lows.slice(0, 7), closes.slice(0, 7), 3)
    expect(truncated).toEqual(full.slice(0, 7))
  })
})
