import { describe, expect, it } from 'vitest'
import { rsiSeries } from './rsi.js'

describe('rsiSeries', () => {
  it('is 100 when there are no losses in the window', () => {
    const rising = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = rsiSeries(rising, 3)
    expect(out[3]).toBe(100)
    expect(out[7]).toBe(100)
  })

  it('is 0 when there are no gains in the window', () => {
    const falling = [8, 7, 6, 5, 4, 3, 2, 1]
    const out = rsiSeries(falling, 3)
    expect(out[3]).toBe(0)
  })

  it('stays within [0, 100] and is null before period+1 points exist', () => {
    const mixed = [10, 12, 9, 13, 11, 14, 10, 15]
    const out = rsiSeries(mixed, 3)
    expect(out.slice(0, 3)).toEqual([null, null, null])
    for (const v of out.slice(3)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('is undefined (null), not 100, on a perfectly flat series — avgGain=avgLoss=0', () => {
    // Corrected 2026-09-25: this used to be asserted as 100 by mistake.
    // Zero gains AND zero losses is mathematically undefined, not
    // "maximally overbought" — see rsi.ts's rsiFromAverages().
    const flat = new Array(20).fill(100)
    const out = rsiSeries(flat, 14)
    expect(out[14]).toBeNull()
    expect(out[19]).toBeNull()
  })

  it('is defined as 100 (not null) when there ARE gains and simply zero losses', () => {
    const risingThenFlat = [...Array(14)].map((_, i) => 100 + i) // strictly rising -> every change is a gain
    const out = rsiSeries(risingThenFlat, 13)
    expect(out[13]).toBe(100)
  })

  it('respects no-lookahead', () => {
    const values = [10, 12, 9, 13, 11, 14, 10, 15]
    const full = rsiSeries(values, 3)
    const truncated = rsiSeries(values.slice(0, 6), 3)
    expect(truncated).toEqual(full.slice(0, 6))
  })
})
