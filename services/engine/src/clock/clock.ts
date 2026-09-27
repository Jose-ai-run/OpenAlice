/**
 * [PROPUESTA] Injectable clock — Hito 1.
 *
 * Every time-dependent component (the scheduler, a cycle's `asOf`) takes
 * a `Clock` instead of calling `Date.now()`/`new Date()` directly, so
 * tests can drive it deterministically and the no-lookahead boundary
 * (`buildStrategyContext`) always has an explicit, injectable `asOf`.
 */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}

export function fixedClock(at: Date): Clock {
  return { now: () => at }
}
