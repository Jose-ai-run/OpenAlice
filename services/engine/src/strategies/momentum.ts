import { z } from 'zod'
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

function roc(bars: StrategyContext['bars'], period: number, i: number): number | null {
  if (i < period) return null
  const now = Number(bars[i]!.close)
  const then = Number(bars[i - period]!.close)
  if (then === 0) return null
  return (now - then) / then
}

export const momentumStrategy: Strategy = {
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
    const change = roc(ctx.bars, params.period, i)
    if (change == null) return { kind: 'NONE' }
    const price = Number(ctx.bars[i]!.close)

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
