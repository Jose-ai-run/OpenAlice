import { z } from 'zod'
import { smaSeries } from '../indicators-series/sma.js'
import { atrSeries } from '../indicators-series/atr.js'
import type { Strategy, StrategyContext, StrategyDecision } from './types.js'

/**
 * [PROPUESTA] Strategy A — trend following. Fast/slow SMA crossover, ATR
 * stop. Template, parametrizable, makes no profitability claim
 * (PROMPT_MASTER_CLAUDE_CODE.md §13).
 */
export const trendFollowingParamsSchema = z.object({
  fastPeriod: z.number().int().positive().default(10),
  slowPeriod: z.number().int().positive().default(30),
  atrPeriod: z.number().int().positive().default(14),
  atrStopMultiplier: z.number().positive().default(2),
})
export type TrendFollowingParams = z.infer<typeof trendFollowingParamsSchema>

function closes(bars: StrategyContext['bars']): number[] {
  return bars.map((b) => Number(b.close))
}
function highs(bars: StrategyContext['bars']): number[] {
  return bars.map((b) => Number(b.high))
}
function lows(bars: StrategyContext['bars']): number[] {
  return bars.map((b) => Number(b.low))
}

export const trendFollowingStrategy: Strategy = {
  id: 'trend-following',
  version: '0.1.0',
  paramsSchema: trendFollowingParamsSchema,
  warmup(rawParams) {
    const params = trendFollowingParamsSchema.parse(rawParams)
    return [{ interval: '1d', bars: Math.max(params.slowPeriod, params.atrPeriod) + 2 }]
  },
  evaluate(ctx: StrategyContext): StrategyDecision {
    const params = trendFollowingParamsSchema.parse(ctx.params)
    const c = closes(ctx.bars)
    const fast = smaSeries(c, params.fastPeriod)
    const slow = smaSeries(c, params.slowPeriod)
    const atr = atrSeries(highs(ctx.bars), lows(ctx.bars), c, params.atrPeriod)

    const i = ctx.bars.length - 1
    if (i < 1) return { kind: 'NONE' }
    const fastNow = fast[i]
    const slowNow = slow[i]
    const fastPrev = fast[i - 1]
    const slowPrev = slow[i - 1]
    const atrNow = atr[i]
    if (fastNow == null || slowNow == null || fastPrev == null || slowPrev == null || atrNow == null) {
      return { kind: 'NONE' }
    }

    const crossedUp = fastPrev <= slowPrev && fastNow > slowNow
    const crossedDown = fastPrev >= slowPrev && fastNow < slowNow
    const price = c[i]!

    if (ctx.position) {
      if (ctx.position.side === 'long' && crossedDown) {
        return { kind: 'EXIT', reasonCodes: ['fast_sma_crossed_below_slow'] }
      }
      if (ctx.position.side === 'short' && crossedUp) {
        return { kind: 'EXIT', reasonCodes: ['fast_sma_crossed_above_slow'] }
      }
      return { kind: 'NONE' }
    }

    if (crossedUp) {
      return {
        kind: 'ENTER',
        side: 'long',
        entry: price,
        stop: price - atrNow * params.atrStopMultiplier,
        score: 0.5,
        reasonCodes: ['fast_sma_crossed_above_slow'],
      }
    }
    if (crossedDown) {
      return {
        kind: 'ENTER',
        side: 'short',
        entry: price,
        stop: price + atrNow * params.atrStopMultiplier,
        score: 0.5,
        reasonCodes: ['fast_sma_crossed_below_slow'],
      }
    }
    return { kind: 'NONE' }
  },
}
