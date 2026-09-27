import { describe, expect, it } from 'vitest'
import { intervalMs, lastBoundaryAtOrBefore, msUntilNextTick, nextBoundaryAfter } from './candle-boundaries.js'

describe('candle-boundaries', () => {
  it('intervalMs matches the declared interval', () => {
    expect(intervalMs('1h')).toBe(3_600_000)
    expect(intervalMs('1m')).toBe(60_000)
  })

  it('lastBoundaryAtOrBefore snaps down to the hour', () => {
    expect(lastBoundaryAtOrBefore(new Date('2026-09-27T14:37:12.000Z'), '1h').toISOString())
      .toBe('2026-09-27T14:00:00.000Z')
  })

  it('lastBoundaryAtOrBefore is a no-op exactly on the boundary', () => {
    expect(lastBoundaryAtOrBefore(new Date('2026-09-27T14:00:00.000Z'), '1h').toISOString())
      .toBe('2026-09-27T14:00:00.000Z')
  })

  it('nextBoundaryAfter is strictly after `from`, even exactly on a boundary', () => {
    expect(nextBoundaryAfter(new Date('2026-09-27T14:00:00.000Z'), '1h').toISOString())
      .toBe('2026-09-27T15:00:00.000Z')
    expect(nextBoundaryAfter(new Date('2026-09-27T14:37:12.000Z'), '1h').toISOString())
      .toBe('2026-09-27T15:00:00.000Z')
  })

  it('msUntilNextTick includes the publication margin', () => {
    // from 14:59:00, next boundary is 15:00:00 (60_000ms away), + 15_000ms margin
    const ms = msUntilNextTick(new Date('2026-09-27T14:59:00.000Z'), '1h', 15_000)
    expect(ms).toBe(60_000 + 15_000)
  })
})
