import { z } from 'zod'
import { rsiSeries } from '../indicators-series/rsi.js'
import { noneDegenerate, withDegenerateGuard } from './guards.js'
import type { Strategy, StrategyContext, StrategyDecision } from './types.js'

/**
 * [PROPUESTA] Strategy B — mean reversion. RSI extremes, exit at the
 * midline. Template, parametrizable, makes no profitability claim
 * (PROMPT_MASTER_CLAUDE_CODE.md §13).
 */
export const meanReversionParamsSchema = z.object({
  rsiPeriod: z.number().int().positive().default(14),
  oversold: z.number().min(0).max(100).default(30),
  overbought: z.number().min(0).max(100).default(70),
  exitMid: z.number().min(0).max(100).default(50),
  stopPct: z.number().positive().default(0.02),
})
export type MeanReversionParams = z.infer<typeof meanReversionParamsSchema>

function closes(bars: StrategyContext['bars']): number[] {
  return bars.map((b) => Number(b.close))
}

const meanReversionStrategyImpl: Strategy = {
  id: 'mean-reversion',
  version: '0.1.0',
  paramsSchema: meanReversionParamsSchema,
  warmup(rawParams) {
    const params = meanReversionParamsSchema.parse(rawParams)
    return [{ interval: '1d', bars: params.rsiPeriod + 2 }]
  },
  evaluate(ctx: StrategyContext): StrategyDecision {
    const params = meanReversionParamsSchema.parse(ctx.params)
    const c = closes(ctx.bars)
    const rsi = rsiSeries(c, params.rsiPeriod)
    const i = ctx.bars.length - 1
    if (i < 0) return noneDegenerate('insufficient_data')
    const rsiNow = rsi[i]
    if (rsiNow == null) {
      // Two distinct causes collapse to the same `null`: not enough bars
      // yet, or (rarer) a perfectly flat window where RSI is genuinely
      // undefined (avgGain=avgLoss=0 — see rsi.ts's rsiFromAverages).
      // Corrected 2026-09-25: this used to fall through and read RSI as
      // 100 (see docs/trading-engine/AUDIT.md) — now it's explicit.
      return noneDegenerate(i < params.rsiPeriod ? 'insufficient_data' : 'flat_series_rsi_undefined')
    }
    const price = c[i]!
    if (!Number.isFinite(price)) return noneDegenerate('non_finite_price')

    if (ctx.position) {
      const backToMid = ctx.position.side === 'long' ? rsiNow >= params.exitMid : rsiNow <= params.exitMid
      if (backToMid) return { kind: 'EXIT', reasonCodes: ['rsi_reverted_to_mid'] }
      return { kind: 'NONE' }
    }

    if (rsiNow <= params.oversold) {
      return {
        kind: 'ENTER',
        side: 'long',
        entry: price,
        stop: price * (1 - params.stopPct),
        score: (params.oversold - rsiNow) / params.oversold,
        reasonCodes: ['rsi_oversold'],
      }
    }
    if (rsiNow >= params.overbought) {
      return {
        kind: 'ENTER',
        side: 'short',
        entry: price,
        stop: price * (1 + params.stopPct),
        score: (rsiNow - params.overbought) / (100 - params.overbought),
        reasonCodes: ['rsi_overbought'],
      }
    }
    return { kind: 'NONE' }
  },
}

/** Guarded export — see guards.ts. This is what every consumer imports. */
export const meanReversionStrategy: Strategy = withDegenerateGuard(meanReversionStrategyImpl)
