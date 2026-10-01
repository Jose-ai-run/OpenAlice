import { describe, expect, it } from 'vitest'
import type { Bar } from '@traderalice/uta-protocol'
import { planWalkForward, sliceByTime } from './walk-forward.js'

function hourlyBars(startIso: string, count: number): Bar[] {
  const start = new Date(startIso).getTime()
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(start + i * 3_600_000), open: '1', high: '1', low: '1', close: '1', volume: '1',
  }))
}

describe('planWalkForward', () => {
  it('produces no folds when the dataset is shorter than IS+OOS+holdout', () => {
    const bars = hourlyBars('2026-01-01T00:00:00.000Z', 24 * 30)  // 1 month
    const plan = planWalkForward(bars)
    expect(plan.folds).toHaveLength(0)
  })

  it('reserves exactly the last 6 months as holdout, never included in any fold', () => {
    const bars = hourlyBars('2020-01-01T00:00:00.000Z', 24 * 365 * 3)  // ~3 years
    const plan = planWalkForward(bars)
    expect(plan.folds.length).toBeGreaterThan(0)
    for (const fold of plan.folds) {
      expect(fold.oosEnd.getTime()).toBeLessThanOrEqual(plan.holdoutStart.getTime())
    }
  })

  it('each fold is IS=12mo then OOS=3mo immediately after, and the next fold starts 3mo later (rolls by the OOS step)', () => {
    const bars = hourlyBars('2020-01-01T00:00:00.000Z', 24 * 365 * 3)
    const plan = planWalkForward(bars)
    const f0 = plan.folds[0]!
    expect(f0.isStart.toISOString()).toBe('2020-01-01T00:00:00.000Z')
    expect(f0.isEnd.toISOString()).toBe('2021-01-01T00:00:00.000Z')
    expect(f0.oosStart.toISOString()).toBe('2021-01-01T00:00:00.000Z')
    expect(f0.oosEnd.toISOString()).toBe('2021-04-01T00:00:00.000Z')
    if (plan.folds.length > 1) {
      expect(plan.folds[1]!.isStart.toISOString()).toBe('2020-04-01T00:00:00.000Z')
    }
  })
})

describe('sliceByTime', () => {
  it('returns only bars within [start, end)', () => {
    const bars = hourlyBars('2026-01-01T00:00:00.000Z', 10)
    const sliced = sliceByTime(bars, new Date('2026-01-01T02:00:00.000Z'), new Date('2026-01-01T05:00:00.000Z'))
    expect(sliced.map((b) => b.timestamp.getUTCHours())).toEqual([2, 3, 4])
  })
})
