import { z } from 'zod'
import { classifyRegimeSeries } from '../regime/regime-classifier.js'
import { trendFollowingStrategy, trendFollowingParamsSchema } from './trend-following.js'
import { meanReversionStrategy, meanReversionParamsSchema } from './mean-reversion.js'
import type { Strategy, StrategyContext, StrategyDecision } from './types.js'

/**
 * [PROPUESTA] Strategy E — regime switch. Classifies trending vs ranging
 * (ADX threshold) and delegates to trend-following in trending regimes,
 * mean-reversion in ranging ones. Template, parametrizable, makes no
 * profitability claim (PROMPT_MASTER_CLAUDE_CODE.md §13).
 */
export const regimeSwitchParamsSchema = z.object({
  adxPeriod: z.number().int().positive().default(14),
  adxThreshold: z.number().positive().default(25),
  trending: trendFollowingParamsSchema.default(trendFollowingParamsSchema.parse({})),
  ranging: meanReversionParamsSchema.default(meanReversionParamsSchema.parse({})),
})
export type RegimeSwitchParams = z.infer<typeof regimeSwitchParamsSchema>

export const regimeSwitchStrategy: Strategy = {
  id: 'regime-switch',
  version: '0.1.0',
  paramsSchema: regimeSwitchParamsSchema,
  warmup(rawParams) {
    const params = regimeSwitchParamsSchema.parse(rawParams)
    const sub = [
      ...trendFollowingStrategy.warmup(params.trending),
      ...meanReversionStrategy.warmup(params.ranging),
    ]
    const maxBars = Math.max(params.adxPeriod * 2, ...sub.map((w) => w.bars))
    return [{ interval: '1d', bars: maxBars }]
  },
  evaluate(ctx: StrategyContext): StrategyDecision {
    const params = regimeSwitchParamsSchema.parse(ctx.params)
    const regimes = classifyRegimeSeries(ctx.bars, params.adxPeriod, params.adxThreshold)
    const regime = regimes[regimes.length - 1] ?? 'unknown'

    if (regime === 'unknown') return { kind: 'NONE' }

    const delegate = regime === 'trending' ? trendFollowingStrategy : meanReversionStrategy
    const delegateParams = regime === 'trending' ? params.trending : params.ranging
    const decision = delegate.evaluate({ ...ctx, params: delegateParams })
    if (decision.kind === 'NONE' || decision.kind === 'ADJUST_STOP') return decision
    if (decision.kind === 'EXIT') return { kind: 'EXIT', reasonCodes: [...decision.reasonCodes, `regime:${regime}`] }
    return { ...decision, reasonCodes: [...decision.reasonCodes, `regime:${regime}`] }
  },
}
