import { describe, expect, it } from 'vitest'
import { checkBarQuality, dropOpenBars, isBarClosed } from './quality.js'
import { cleanDailyBars } from './test-fixtures.js'

describe('checkBarQuality', () => {
  it('clean series has no findings', () => {
    const report = checkBarQuality(cleanDailyBars(), '1d')
    expect(report.inspected).toBe(5)
    expect(report.duplicates).toEqual([])
    expect(report.gaps).toEqual([])
    expect(report.invalidOhlc).toEqual([])
  })

  it('detects a duplicate timestamp', () => {
    const bars = cleanDailyBars()
    bars[2] = { ...bars[1]! } // day 3 becomes a duplicate of day 2
    const report = checkBarQuality(bars, '1d')
    expect(report.duplicates).toHaveLength(1)
    expect(report.duplicates[0]!.index).toBe(2)
  })

  it('detects a gap (missing bar)', () => {
    const bars = cleanDailyBars()
    bars.splice(2, 1) // remove day 3 -> day 2 to day 4 is a 1-bar gap
    const report = checkBarQuality(bars, '1d')
    expect(report.gaps).toHaveLength(1)
    expect(report.gaps[0]!.missingBars).toBe(1)
  })

  it('detects invalid OHLC (high < low)', () => {
    const bars = cleanDailyBars()
    bars[1] = { ...bars[1]!, high: '50', low: '200' }
    const report = checkBarQuality(bars, '1d')
    expect(report.invalidOhlc).toHaveLength(1)
    expect(report.invalidOhlc[0]!.index).toBe(1)
    expect(report.invalidOhlc[0]!.reason).toContain('high < low')
  })

  it('detects a non-numeric OHLC field', () => {
    const bars = cleanDailyBars()
    bars[0] = { ...bars[0]!, close: 'not-a-number' }
    const report = checkBarQuality(bars, '1d')
    expect(report.invalidOhlc).toHaveLength(1)
    expect(report.invalidOhlc[0]!.reason).toContain('close is not a finite number')
  })
})

describe('isBarClosed / dropOpenBars', () => {
  it('a bar is open until now reaches its close time', () => {
    const bar = { timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0)), open: '1', high: '1', low: '1', close: '1', volume: '1' }
    const stillOpen = new Date(Date.UTC(2026, 0, 1, 23, 0)) // 23h into a 1d bar
    const justClosed = new Date(Date.UTC(2026, 0, 2, 0, 0)) // exactly 24h later
    expect(isBarClosed(bar, '1d', stillOpen)).toBe(false)
    expect(isBarClosed(bar, '1d', justClosed)).toBe(true)
  })

  it('drops only the trailing open bar, keeps closed history', () => {
    const bars = cleanDailyBars() // day 1..5
    // "now" is mid-day-5 -> day 5's bar has not closed yet.
    const now = new Date(Date.UTC(2026, 0, 5, 12, 0))
    const closed = dropOpenBars(bars, '1d', now)
    expect(closed).toHaveLength(4)
    expect(closed[closed.length - 1]!.timestamp.getUTCDate()).toBe(4)
  })

  it('keeps everything when the last bar has already closed', () => {
    const bars = cleanDailyBars()
    const now = new Date(Date.UTC(2026, 0, 10)) // well past day 5's close
    expect(dropOpenBars(bars, '1d', now)).toHaveLength(5)
  })
})
