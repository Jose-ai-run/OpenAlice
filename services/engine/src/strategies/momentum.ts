import { z } from 'zod'
import { noneDegenerate, withDegenerateGuard } from './guards.js'
import type { Strategy, StrategyContext, StrategyDecision } from './types.js'

/**
 * [PROPUESTA] Strategy D — momentum. Rate-of-change over `period` bars past
 * a threshold. Template, parametrizable, makes no profitability claim
 * (PROMPT_MASTER_CLAUDE_CODE.md §13).
 */
export const momentumParamsSchema = z.object({
  period: z.number().int().positive().default(10),
  threshold: z.number().positive().default(0.05),
  stopPct: z.number().positive().default(0.03),
  timeStopBars: z.number().int().positive().default(20),
})
export type MomentumParams = z.infer<typeof momentumParamsSchema>

type RocResult = { value: number } | { degenerate: string }

function roc(bars: StrategyContext['bars'], period: number, i: number): RocResult | null {
  if (i < period) return null // insufficient data — caller distinguishes this from degenerate
  const now = Number(bars[i]!.close)
  const then = Number(bars[i - period]!.close)
  if (!Number.isFinite(now) || !Number.isFinite(then)) return { degenerate: 'non_finite_price' }
  if (then === 0) return { degenerate: 'zero_reference_price' } // would divide by zero
  return { value: (now - then) / then }
}

const momentumStrategyImpl: Strategy = {
  id: 'momentum',
  version: '0.1.0',
  paramsSchema: momentumParamsSchema,
  warmup(rawParams) {
    const params = momentumParamsSchema.parse(rawParams)
    return [{ interval: '1d', bars: params.period + 1 }]
  },
  evaluate(ctx: StrategyContext): StrategyDecision {
    const params = momentumParamsSchema.parse(ctx.params)
    const i = ctx.bars.length - 1
    const rocResult = roc(ctx.bars, params.period, i)
    if (rocResult == null) return noneDegenerate('insufficient_data')
    if ('degenerate' in rocResult) return noneDegenerate(rocResult.degenerate)
    const change = rocResult.value
    const price = Number(ctx.bars[i]!.close)
    if (!Number.isFinite(price)) return noneDegenerate('non_finite_price')

    if (ctx.position) {
      const faded = ctx.position.side === 'long' ? change <= 0 : change >= 0
      if (faded) return { kind: 'EXIT', reasonCodes: ['momentum_faded'] }
      return { kind: 'NONE' }
    }

    if (change >= params.threshold) {
      return {
        kind: 'ENTER',
        side: 'long',
        entry: price,
        stop: price * (1 - params.stopPct),
        score: Math.min(1, change / (params.threshold * 2)),
        reasonCodes: ['roc_above_threshold'],
        timeStopBars: params.timeStopBars,
      }
    }
    if (change <= -params.threshold) {
      return {
        kind: 'ENTER',
        side: 'short',
        entry: price,
        stop: price * (1 + params.stopPct),
        score: Math.min(1, -change / (params.threshold * 2)),
        reasonCodes: ['roc_below_threshold'],
        timeStopBars: params.timeStopBars,
      }
    }
    return { kind: 'NONE' }
  },
}

/** Guarded export — see guards.ts. This is what every consumer imports. */
export const momentumStrategy: Strategy = withDegenerateGuard(momentumStrategyImpl)
