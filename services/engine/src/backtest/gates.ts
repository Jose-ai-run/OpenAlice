/**
 * [PROPUESTA] F6 gates (ADR-0011 §5) — mechanical PASS/FAIL, no judgment
 * calls at evaluation time (every threshold was fixed in the ADR before
 * any backtest ran). Gate 8 (no-lookahead/determinism tests green) is NOT
 * evaluated here — it's a build-time property reported separately by the
 * grid runner from the real `vitest` exit code, never fabricated.
 */
import type { TradeMetrics } from './metrics.js'
import type { MonotonicityResult } from './monotonicity.js'

export interface GateResult {
  code: string
  label: string
  status: 'pass' | 'fail' | 'n/a'
  detail: string
}

export interface GateInputs {
  metrics: TradeMetrics
  isLowFrequency: boolean
  regimeTransitionsInOOS: number
  bootstrapExpectancyLowerBound: number
  bootstrapSharpeLowerBoundAdjusted: number
  /** Sharpe of grid-neighbor combinations (same strategy, one param stepped to its adjacent tested value). Empty if none exist. */
  neighborSharpes: number[]
  monotonicity: MonotonicityResult
}

export function evaluateGates(inputs: GateInputs): GateResult[] {
  const { metrics, isLowFrequency, regimeTransitionsInOOS, bootstrapExpectancyLowerBound, bootstrapSharpeLowerBoundAdjusted, neighborSharpes, monotonicity } = inputs
  const results: GateResult[] = []

  const minTrades = isLowFrequency && regimeTransitionsInOOS >= 3 ? 100 : 200
  results.push({
    code: 'G1', label: `>=${minTrades} trades OOS`,
    status: metrics.totalTrades >= minTrades ? 'pass' : 'fail',
    detail: `${metrics.totalTrades} trades (umbral ${minTrades}${isLowFrequency ? `, baja frecuencia, ${regimeTransitionsInOOS} transiciones de régimen` : ''})`,
  })

  results.push({
    code: 'G2', label: 'IC95 bootstrap expectativa > 0',
    status: bootstrapExpectancyLowerBound > 0 ? 'pass' : 'fail',
    detail: `límite inferior = ${bootstrapExpectancyLowerBound.toFixed(4)}R`,
  })

  results.push({
    code: 'G3', label: 'profit factor >= 1.2',
    status: metrics.profitFactor >= 1.2 ? 'pass' : 'fail',
    detail: `PF = ${Number.isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : '∞'}`,
  })

  results.push({
    code: 'G4', label: 'max drawdown <= 12%',
    status: metrics.maxDrawdownPct <= 12 ? 'pass' : 'fail',
    detail: `maxDD = ${metrics.maxDrawdownPct.toFixed(2)}%`,
  })

  results.push({
    code: 'G5', label: 'Sharpe >= 0.8 (ajustado, Bonferroni N=92)',
    status: bootstrapSharpeLowerBoundAdjusted >= 0.8 ? 'pass' : 'fail',
    detail: `límite inferior ajustado = ${bootstrapSharpeLowerBoundAdjusted.toFixed(3)} (puntual: ${metrics.sharpeAnnualized.toFixed(3)})`,
  })

  if (neighborSharpes.length === 0) {
    results.push({ code: 'G6', label: 'estabilidad ±20% en parámetros', status: 'n/a', detail: 'sin combinaciones vecinas en la grilla' })
  } else {
    const within = neighborSharpes.every((s) => Math.abs(s - metrics.sharpeAnnualized) <= Math.abs(metrics.sharpeAnnualized) * 0.2)
    results.push({
      code: 'G6', label: 'estabilidad ±20% en parámetros',
      status: within ? 'pass' : 'fail',
      detail: `vecinos: [${neighborSharpes.map((s) => s.toFixed(3)).join(', ')}] vs ${metrics.sharpeAnnualized.toFixed(3)}`,
    })
  }

  results.push({
    code: 'G7', label: 'ningún mes > 30% del PnL',
    status: Number.isNaN(metrics.monthlyConcentration) ? 'n/a' : (metrics.monthlyConcentration <= 0.30 ? 'pass' : 'fail'),
    detail: Number.isNaN(metrics.monthlyConcentration) ? 'PnL total <= 0 — gate no aplicable' : `mes máximo = ${(metrics.monthlyConcentration * 100).toFixed(1)}%`,
  })

  results.push({
    code: 'G8', label: 'A3 — monotonía por quintil de score',
    status: monotonicity.status,
    detail: monotonicity.status === 'n/a' ? (monotonicity.reason ?? 'n/a') : `Spearman = ${monotonicity.spearman?.toFixed(3)}`,
  })

  return results
}

export function allGatesPass(results: readonly GateResult[]): boolean {
  return results.every((r) => r.status === 'pass' || r.status === 'n/a')
}
