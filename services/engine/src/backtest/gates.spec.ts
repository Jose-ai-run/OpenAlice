import { describe, expect, it } from 'vitest'
import { evaluateGates, allGatesPass } from './gates.js'
import type { TradeMetrics } from './metrics.js'
import type { MonotonicityResult } from './monotonicity.js'

function baseMetrics(overrides: Partial<TradeMetrics> = {}): TradeMetrics {
  return {
    totalTrades: 250, totalPnl: 1000, winRate: 0.5, avgWin: 20, avgLoss: -10,
    profitFactor: 1.5, expectancyR: 0.3, maxDrawdownPct: 8, sharpeAnnualized: 1.1,
    monthlyConcentration: 0.15, ...overrides,
  }
}
const passingMonotonicity: MonotonicityResult = { status: 'pass', quintileExpectancy: [0.1, 0.2, 0.3, 0.4, 0.5], spearman: 1 }

describe('evaluateGates', () => {
  it('all pass with a clean, gate-satisfying input', () => {
    const results = evaluateGates({
      metrics: baseMetrics(), isLowFrequency: false, regimeTransitionsInOOS: 5,
      bootstrapExpectancyLowerBound: 0.1, bootstrapSharpeLowerBoundAdjusted: 0.9,
      neighborSharpes: [1.05, 1.15], monotonicity: passingMonotonicity,
    })
    expect(allGatesPass(results)).toBe(true)
    expect(results.find((r) => r.code === 'G1')?.status).toBe('pass')
  })

  it('G1 requires 200 trades at normal frequency, 100 if low-frequency with >=3 regimes', () => {
    const lowFreqFail = evaluateGates({
      metrics: baseMetrics({ totalTrades: 90 }), isLowFrequency: true, regimeTransitionsInOOS: 3,
      bootstrapExpectancyLowerBound: 0.1, bootstrapSharpeLowerBoundAdjusted: 0.9,
      neighborSharpes: [], monotonicity: passingMonotonicity,
    })
    expect(lowFreqFail.find((r) => r.code === 'G1')?.status).toBe('fail')

    const lowFreqPass = evaluateGates({
      metrics: baseMetrics({ totalTrades: 150 }), isLowFrequency: true, regimeTransitionsInOOS: 3,
      bootstrapExpectancyLowerBound: 0.1, bootstrapSharpeLowerBoundAdjusted: 0.9,
      neighborSharpes: [], monotonicity: passingMonotonicity,
    })
    expect(lowFreqPass.find((r) => r.code === 'G1')?.status).toBe('pass')
  })

  it('G2 fails when the bootstrap expectancy lower bound is <= 0', () => {
    const results = evaluateGates({
      metrics: baseMetrics(), isLowFrequency: false, regimeTransitionsInOOS: 5,
      bootstrapExpectancyLowerBound: -0.01, bootstrapSharpeLowerBoundAdjusted: 0.9,
      neighborSharpes: [], monotonicity: passingMonotonicity,
    })
    expect(results.find((r) => r.code === 'G2')?.status).toBe('fail')
  })

  it('G6 fails when a neighbor Sharpe is more than 20% away from the winner', () => {
    const results = evaluateGates({
      metrics: baseMetrics({ sharpeAnnualized: 1.0 }), isLowFrequency: false, regimeTransitionsInOOS: 5,
      bootstrapExpectancyLowerBound: 0.1, bootstrapSharpeLowerBoundAdjusted: 0.9,
      neighborSharpes: [0.5], monotonicity: passingMonotonicity,  // 50% away
    })
    expect(results.find((r) => r.code === 'G6')?.status).toBe('fail')
  })

  it('G6 is n/a with no neighbors in the grid, and n/a does not block allGatesPass', () => {
    const results = evaluateGates({
      metrics: baseMetrics(), isLowFrequency: false, regimeTransitionsInOOS: 5,
      bootstrapExpectancyLowerBound: 0.1, bootstrapSharpeLowerBoundAdjusted: 0.9,
      neighborSharpes: [], monotonicity: passingMonotonicity,
    })
    expect(results.find((r) => r.code === 'G6')?.status).toBe('n/a')
    expect(allGatesPass(results)).toBe(true)
  })

  it('allGatesPass is false if even one gate fails', () => {
    const results = evaluateGates({
      metrics: baseMetrics({ maxDrawdownPct: 20 }), isLowFrequency: false, regimeTransitionsInOOS: 5,
      bootstrapExpectancyLowerBound: 0.1, bootstrapSharpeLowerBoundAdjusted: 0.9,
      neighborSharpes: [], monotonicity: passingMonotonicity,
    })
    expect(results.find((r) => r.code === 'G4')?.status).toBe('fail')
    expect(allGatesPass(results)).toBe(false)
  })
})
