import { expect } from 'vitest'
import type { Strategy, StrategyContext, StrategyDecision } from './types.js'

/**
 * Walks a strategy bar-by-bar (as a real backtest loop would), tracking a
 * single open position, and returns every decision keyed by index. Purely
 * a test helper — the Engine's real ExecutionManager (a later Fase) owns
 * actual position tracking.
 */
export function walkForward(
  strategy: Strategy,
  bars: StrategyContext['bars'],
  params: unknown,
  warmupBars: number,
): Array<{ index: number; decision: StrategyDecision }> {
  const results: Array<{ index: number; decision: StrategyDecision }> = []
  let position: StrategyContext['position']
  for (let i = warmupBars; i < bars.length; i++) {
    const decision = strategy.evaluate({ bars: bars.slice(0, i + 1), interval: '1d', params, position })
    results.push({ index: i, decision })
    if (decision.kind === 'ENTER') position = { side: decision.side, entry: decision.entry, stop: decision.stop }
    else if (decision.kind === 'EXIT') position = undefined
    else if (decision.kind === 'ADJUST_STOP' && position) position = { ...position, stop: decision.newStop }
  }
  return results
}

/**
 * Shared assertions for PROMPT_MASTER_CLAUDE_CODE.md §37 F3: "tests de
 * pureza, no-lookahead y determinismo para A–E". Reused by every strategy
 * spec so the property is checked identically across all five.
 */

/** Same (deep-equal but distinct) context, called twice, must decide identically. */
export function assertPure(strategy: Strategy, ctx: StrategyContext): void {
  const cloned: StrategyContext = { ...ctx, bars: [...ctx.bars] }
  expect(strategy.evaluate(ctx)).toEqual(strategy.evaluate(cloned))
}

/**
 * Poisons Date.now/Math.random so any evaluate() call that secretly reads
 * either one throws — proves determinism structurally, not just "ran twice
 * and matched" (which unseeded-but-idle randomness could pass by luck).
 */
export function assertDeterministic(strategy: Strategy, ctx: StrategyContext): void {
  const realDateNow = Date.now
  const realRandom = Math.random
  Date.now = () => { throw new Error('evaluate() must not call Date.now()') }
  Math.random = () => { throw new Error('evaluate() must not call Math.random()') }
  try {
    expect(() => strategy.evaluate(ctx)).not.toThrow()
  } finally {
    Date.now = realDateNow
    Math.random = realRandom
  }
}

/**
 * The name every side-channel bait field is smuggled under. Exported so
 * test/property/lookahead-trap-strategy.ts can read the same name; a real
 * strategy has no reason to know this name exists and never reads it.
 */
export const NO_LOOKAHEAD_BAIT_KEY = '__noLookaheadBaitFutureBars'

/**
 * The decision at cut point `k` (i.e. evaluated on bars[0..k)) must be
 * identical regardless of what the underlying data looks like AFTER k.
 *
 * CORRECTED 2026-09-25: the original version only ever compared
 * `fullA.slice(0, k)` against `fullB.slice(0, k)` — two arrays that are
 * *content-identical by construction* whenever fullA/fullB agree up to k
 * (which every caller arranges). A strategy that only reads `ctx.bars`
 * therefore passed trivially, by the type signature alone, without this
 * assertion doing any real work — it could not have caught a real
 * lookahead bug, only a purity bug tied to array *identity*. See
 * test/property/lookahead-trap.spec.ts for the mutation test that exposed
 * this and proves the fix below actually has teeth.
 *
 * Fix: also smuggle the bars AFTER `k` into `ctx.params` under
 * `NO_LOOKAHEAD_BAIT_KEY`, differently for fullA and fullB. Every current
 * strategy parses `ctx.params` through a Zod object schema that silently
 * strips unrecognized keys (none of our schemas use `.strict()`), so this
 * is invisible to correctly-written strategies — they never look at raw
 * `ctx.params`, only at their own parsed, typed params. A strategy that
 * DOES read this side channel (the realistic shape of a lookahead bug:
 * extra debug/context data leaking through an `unknown`-typed params
 * field) now diverges between the two calls and this assertion catches it.
 */
export function assertNoLookahead(
  strategy: Strategy,
  fullA: StrategyContext['bars'],
  fullB: StrategyContext['bars'],
  k: number,
  params: unknown,
): void {
  const paramsA = { ...(params as Record<string, unknown> ?? {}), [NO_LOOKAHEAD_BAIT_KEY]: fullA.slice(k) }
  const paramsB = { ...(params as Record<string, unknown> ?? {}), [NO_LOOKAHEAD_BAIT_KEY]: fullB.slice(k) }
  const a = strategy.evaluate({ bars: fullA.slice(0, k), interval: '1d', params: paramsA })
  const b = strategy.evaluate({ bars: fullB.slice(0, k), interval: '1d', params: paramsB })
  expect(a).toEqual(b)
}
