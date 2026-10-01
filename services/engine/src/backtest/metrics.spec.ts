import { describe, expect, it } from 'vitest'
import type { BacktestTrade, BacktestResult } from './types.js'
import { computeMetrics, maxDrawdownPct } from './metrics.js'

function trade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    side: 'long', entryTime: new Date('2026-01-01T00:00:00.000Z'), entryPrice: 100, stop: 90,
    exitTime: new Date('2026-01-02T00:00:00.000Z'), exitPrice: 105, exitReason: 'signal_exit',
    qty: 1, pnl: 5, pnlR: 0.5, score: 0.5, ...overrides,
  }
}

describe('computeMetrics', () => {
  it('computes win rate, profit factor, expectancy from a simple mixed set', () => {
    const trades = [
      trade({ pnl: 10, pnlR: 1 }),
      trade({ pnl: -5, pnlR: -0.5 }),
      trade({ pnl: 10, pnlR: 1 }),
    ]
    const equityCurve: BacktestResult['equityCurve'] = [
      { time: new Date('2025-12-31T00:00:00.000Z'), equity: 1000 },
      { time: new Date('2026-01-02T00:00:00.000Z'), equity: 1015 },
    ]
    const m = computeMetrics(trades, equityCurve, 52)
    expect(m.totalTrades).toBe(3)
    expect(m.winRate).toBeCloseTo(2 / 3)
    expect(m.profitFactor).toBeCloseTo(20 / 5)
    expect(m.expectancyR).toBeCloseTo((1 - 0.5 + 1) / 3)
  })

  it('profit factor is Infinity with wins and zero losses', () => {
    const m = computeMetrics([trade({ pnl: 10 }), trade({ pnl: 5 })], [], 52)
    expect(m.profitFactor).toBe(Infinity)
  })

  it('flags the single month that carries >30% of total PnL', () => {
    const trades = [
      trade({ exitTime: new Date('2026-01-15T00:00:00.000Z'), pnl: 90 }),
      trade({ exitTime: new Date('2026-02-15T00:00:00.000Z'), pnl: 5 }),
      trade({ exitTime: new Date('2026-03-15T00:00:00.000Z'), pnl: 5 }),
    ]
    const m = computeMetrics(trades, [], 52)
    expect(m.monthlyConcentration).toBeCloseTo(0.9)
  })

  it('monthlyConcentration is NaN (gate N/A) when total PnL is not positive', () => {
    const m = computeMetrics([trade({ pnl: -10 })], [], 52)
    expect(Number.isNaN(m.monthlyConcentration)).toBe(true)
  })
})

describe('maxDrawdownPct', () => {
  it('computes the real peak-to-trough percentage', () => {
    const curve: BacktestResult['equityCurve'] = [
      { time: new Date(0), equity: 1000 },
      { time: new Date(1), equity: 1200 },
      { time: new Date(2), equity: 900 },  // -25% from peak 1200
      { time: new Date(3), equity: 1100 },
    ]
    expect(maxDrawdownPct(curve)).toBeCloseTo(25)
  })

  it('is 0 for a monotonically rising equity curve', () => {
    const curve: BacktestResult['equityCurve'] = [{ time: new Date(0), equity: 1000 }, { time: new Date(1), equity: 1100 }]
    expect(maxDrawdownPct(curve)).toBe(0)
  })
})
