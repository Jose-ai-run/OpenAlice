import { describe, expect, it } from 'vitest'
import { bootstrapLowerBound, mean, stddevOf, sharpeStatistic, seededRng } from './bootstrap.js'

describe('seededRng', () => {
  it('is deterministic for the same seed', () => {
    const a = seededRng(42)
    const b = seededRng(42)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
  })
  it('produces values in [0, 1)', () => {
    const rng = seededRng(1)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('mean / stddevOf', () => {
  it('computes correctly on a known set', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3)
    expect(stddevOf([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2)
  })
})

describe('bootstrapLowerBound', () => {
  it('is deterministic given a seeded rng', () => {
    const values = [1, 2, 3, -1, 2, 1, 3, -2, 1, 2]
    const a = bootstrapLowerBound(values, { iterations: 500, lowerPercentile: 2.5, rng: seededRng(7) })
    const b = bootstrapLowerBound(values, { iterations: 500, lowerPercentile: 2.5, rng: seededRng(7) })
    expect(a).toBe(b)
  })

  it('a clearly-positive sample has a positive lower bound at a lenient percentile', () => {
    const values = Array.from({ length: 50 }, () => 1 + Math.random() * 0.01)  // all ~1, trivially positive
    const lb = bootstrapLowerBound(values, { iterations: 1000, lowerPercentile: 2.5, rng: seededRng(1) })
    expect(lb).toBeGreaterThan(0)
  })

  it('returns NaN for an empty sample', () => {
    expect(bootstrapLowerBound([], { iterations: 100, lowerPercentile: 2.5 })).toBeNaN()
  })

  it('accepts a custom statistic function (sharpeStatistic)', () => {
    const values = [0.01, 0.02, -0.01, 0.015, 0.005, -0.005, 0.02]
    const lb = bootstrapLowerBound(values, { iterations: 300, lowerPercentile: 5, rng: seededRng(3) }, sharpeStatistic)
    expect(typeof lb).toBe('number')
  })
})
