import { z } from 'zod'
import type { Strategy, StrategyContext, StrategyDecision } from './types.js'

/**
 * [PROPUESTA] Strategy C — breakout. Close breaks above/below the prior
 * N-bar high/low. Template, parametrizable, makes no profitability claim
 * (PROMPT_MASTER_CLAUDE_CODE.md §13).
 */
export const breakoutParamsSchema = z.object({
  lookback: z.number().int().positive().default(20),
  stopBufferPct: z.number().min(0).default(0.005),
})
export type BreakoutParams = z.infer<typeof breakoutParamsSchema>

export const breakoutStrategy: Strategy = {
  id: 'breakout',
  version: '0.1.0',
  paramsSchema: breakoutParamsSchema,
  warmup(rawParams) {
    const params = breakoutParamsSchema.parse(rawParams)
    return [{ interval: '1d', bars: params.lookback + 1 }]
  },
  evaluate(ctx: StrategyContext): StrategyDecision {
    const params = breakoutParamsSchema.parse(ctx.params)
    const n = ctx.bars.length
    const i = n - 1
    if (i < params.lookback) return { kind: 'NONE' }

    // Prior window EXCLUDES the current bar — comparing against a threshold
    // that includes today's own high/low would make every bar trivially
    // "break out" of itself.
    const window = ctx.bars.slice(i - params.lookback, i)
    const priorHigh = Math.max(...window.map((b) => Number(b.high)))
    const priorLow = Math.min(...window.map((b) => Number(b.low)))
    const close = Number(ctx.bars[i]!.close)

    if (ctx.position) {
      // Simple symmetric exit: price re-enters the prior range.
      if (ctx.position.side === 'long' && close < priorHigh) return { kind: 'EXIT', reasonCodes: ['reentered_prior_range'] }
      if (ctx.position.side === 'short' && close > priorLow) return { kind: 'EXIT', reasonCodes: ['reentered_prior_range'] }
      return { kind: 'NONE' }
    }

    if (close > priorHigh) {
      return {
        kind: 'ENTER',
        side: 'long',
        entry: close,
        stop: priorLow * (1 - params.stopBufferPct),
        score: Math.min(1, (close - priorHigh) / priorHigh),
        reasonCodes: ['closed_above_prior_high'],
      }
    }
    if (close < priorLow) {
      return {
        kind: 'ENTER',
        side: 'short',
        entry: close,
        stop: priorHigh * (1 + params.stopBufferPct),
        score: Math.min(1, (priorLow - close) / priorLow),
        reasonCodes: ['closed_below_prior_low'],
      }
    }
    return { kind: 'NONE' }
  },
}
