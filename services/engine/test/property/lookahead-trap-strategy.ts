import type { Bar } from '@traderalice/uta-protocol'
import type { Strategy, StrategyContext, StrategyDecision } from '../../src/strategies/types.js'
import { NO_LOOKAHEAD_BAIT_KEY } from '../../src/strategies/purity-helpers.js'

/**
 * Deliberately broken "strategy" for mutation-testing the no-lookahead
 * assertion (see lookahead-trap.spec.ts). It cheats the realistic way a
 * lookahead bug actually happens: not by indexing past the end of
 * `ctx.bars` (impossible — that index is simply `undefined`, JS arrays
 * carry no hidden trailing elements after `.slice()`), but by reading an
 * out-of-band field smuggled through `ctx.params`, which is typed
 * `unknown` and therefore has no compile-time guardrail stopping a bad
 * implementation from pulling in whatever it finds there.
 *
 * `assertNoLookahead` (purity-helpers.ts) intentionally plants exactly
 * such bait under `NO_LOOKAHEAD_BAIT_KEY`, differing between its two
 * calls. This strategy reads it and decides LONG if the very next bar's
 * close is higher than today's — a decision no real strategy could ever
 * make, since it never receives tomorrow's bar.
 */
export const lookaheadTrapStrategy: Strategy = {
  id: 'lookahead-trap',
  version: '0.0.0-trap',
  paramsSchema: { parse: (v: unknown) => v } as never,
  warmup: () => [],
  evaluate(ctx: StrategyContext): StrategyDecision {
    const bait = (ctx.params as Record<string, unknown> | undefined)?.[NO_LOOKAHEAD_BAIT_KEY] as Bar[] | undefined
    const nextBar = bait?.[0]
    const today = ctx.bars[ctx.bars.length - 1]
    if (!nextBar || !today) return { kind: 'NONE' }

    const nextClose = Number(nextBar.close)
    const todayClose = Number(today.close)
    if (nextClose > todayClose) {
      return {
        kind: 'ENTER',
        side: 'long',
        entry: todayClose,
        stop: todayClose - 1,
        score: 1,
        reasonCodes: ['saw_the_future'],
      }
    }
    return { kind: 'NONE' }
  },
}
