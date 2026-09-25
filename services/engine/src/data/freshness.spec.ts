import { describe, expect, it } from 'vitest'
import { measureFreshness } from './freshness.js'
import { cleanDailyBars } from './test-fixtures.js'

describe('measureFreshness', () => {
  it('reports null when there are no bars', () => {
    expect(measureFreshness([], new Date())).toEqual({ latestBarTimestamp: null, dataAgeSeconds: null })
  })

  it('measures age from the latest bar to now', () => {
    const bars = cleanDailyBars() // last bar: 2026-01-05T00:00:00Z
    const now = new Date(Date.UTC(2026, 0, 5, 1, 0, 0)) // +1h
    const fresh = measureFreshness(bars, now)
    expect(fresh.latestBarTimestamp).toBe('2026-01-05T00:00:00.000Z')
    expect(fresh.dataAgeSeconds).toBe(3600)
  })

  it('never reports a negative age', () => {
    const bars = cleanDailyBars()
    const now = new Date(Date.UTC(2025, 0, 1)) // before the data, clock skew case
    expect(measureFreshness(bars, now).dataAgeSeconds).toBe(0)
  })
})
