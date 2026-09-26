import { trendFollowingStrategy } from './trend-following.js'
import { meanReversionStrategy } from './mean-reversion.js'
import { breakoutStrategy } from './breakout.js'
import { momentumStrategy } from './momentum.js'
import { regimeSwitchStrategy } from './regime-switch.js'
import type { Strategy } from './types.js'

/** [PROPUESTA] A–E from PROMPT_MASTER_CLAUDE_CODE.md §2/§13. */
export const strategyRegistry: Record<string, Strategy> = {
  [trendFollowingStrategy.id]: trendFollowingStrategy,
  [meanReversionStrategy.id]: meanReversionStrategy,
  [breakoutStrategy.id]: breakoutStrategy,
  [momentumStrategy.id]: momentumStrategy,
  [regimeSwitchStrategy.id]: regimeSwitchStrategy,
}

export function getStrategy(id: string): Strategy | undefined {
  return strategyRegistry[id]
}
