import type { z } from 'zod'
import type { Bar, BarInterval } from '@traderalice/uta-protocol'

/**
 * [PROPUESTA] Strategy SDK — PROMPT_MASTER_CLAUDE_CODE.md §13, verbatim
 * interface. `evaluate` must be pure: no I/O, no `Date.now()`, no
 * unseeded randomness. No-lookahead is structural: `ctx.bars` IS the
 * strategy's entire view of history, truncated at "now" by the caller —
 * a strategy that only reads `ctx.bars` cannot see the future by
 * construction. See each strategy's *.spec.ts for the truncation proof.
 */
export interface StrategyContext {
  /** Historical bars up to and including "now" — nothing later exists. */
  bars: readonly Bar[]
  interval: BarInterval
  params: unknown
  /** The strategy's own currently open position for this symbol, if any. */
  position?: { side: 'long' | 'short'; entry: number; stop: number }
}

export type StrategyDecision =
  | {
      kind: 'NONE'
      /** Optional — populated with e.g. ['DEGENERATE_INPUT', 'flat_series']
       *  when NONE means "input was unusable", not "no signal today". See
       *  strategies/guards.ts. */
      reasonCodes?: string[]
    }
  | {
      kind: 'ENTER'
      side: 'long' | 'short'
      entry: number
      /** Obligatorio — PROMPT_MASTER §13. */
      stop: number
      target?: number
      /** 0..1 */
      score: number
      reasonCodes: string[]
      timeStopBars?: number
    }
  | { kind: 'EXIT'; reasonCodes: string[] }
  | {
      /** Solo puede apretar el stop — PROMPT_MASTER §13. Callers must
       *  verify newStop tightens (never loosens) before acting on this. */
      kind: 'ADJUST_STOP'
      newStop: number
    }

export interface WarmupRequirement {
  interval: BarInterval
  bars: number
}

export interface Strategy {
  id: string
  version: string
  paramsSchema: z.ZodType
  warmup(params: unknown): WarmupRequirement[]
  evaluate(ctx: StrategyContext): StrategyDecision
}
