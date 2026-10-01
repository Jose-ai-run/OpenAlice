import { describe, expect, it } from 'vitest'
import type { BacktestTrade } from './types.js'
import { checkMonotonicity } from './monotonicity.js'

function trade(score: number, pnlR: number): BacktestTrade {
  return {
    side: 'long', entryTime: new Date(), entryPrice: 100, stop: 90, exitTime: new Date(),
    exitPrice: 105, exitReason: 'signal_exit', qty: 1, pnl: pnlR, pnlR, score,
  }
}

describe('checkMonotonicity', () => {
  it('is n/a below the minimum sample size', () => {
    const trades = Array.from({ length: 10 }, (_, i) => trade(i / 10, 0.1))
    expect(checkMonotonicity(trades).status).toBe('n/a')
  })

  it('passes when higher-score quintiles have higher mean expectancy', () => {
    const trades = Array.from({ length: 50 }, (_, i) => trade(i / 50, i / 50))  // score and R perfectly correlated
    const result = checkMonotonicity(trades)
    expect(result.status).toBe('pass')
    expect(result.spearman).toBeCloseTo(1, 1)
  })

  it('fails when higher-score quintiles have LOWER mean expectancy (inverted)', () => {
    const trades = Array.from({ length: 50 }, (_, i) => trade(i / 50, -(i / 50)))  // inverted
    const result = checkMonotonicity(trades)
    expect(result.status).toBe('fail')
    expect(result.spearman).toBeLessThan(0)
  })
})
