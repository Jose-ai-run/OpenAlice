import { describe, expect, it } from 'vitest'
import { guardDecision, withDegenerateGuard, DEGENERATE_INPUT } from './guards.js'
import type { Strategy, StrategyDecision } from './types.js'

describe('guardDecision', () => {
  it('passes through a well-formed ENTER unchanged', () => {
    const decision: StrategyDecision = { kind: 'ENTER', side: 'long', entry: 100, stop: 98, score: 0.5, reasonCodes: ['x'] }
    expect(guardDecision(decision)).toEqual(decision)
  })

  it('downgrades an ENTER with a non-finite entry/stop/score/target to NONE + DEGENERATE_INPUT', () => {
    for (const bad of [
      { kind: 'ENTER', side: 'long', entry: NaN, stop: 98, score: 0.5, reasonCodes: [] },
      { kind: 'ENTER', side: 'long', entry: 100, stop: Infinity, score: 0.5, reasonCodes: [] },
      { kind: 'ENTER', side: 'long', entry: 100, stop: 98, score: NaN, reasonCodes: [] },
      { kind: 'ENTER', side: 'long', entry: 100, stop: 98, score: 0.5, target: -Infinity, reasonCodes: [] },
    ] as StrategyDecision[]) {
      const guarded = guardDecision(bad)
      expect(guarded.kind).toBe('NONE')
      expect((guarded as { reasonCodes?: string[] }).reasonCodes).toContain(DEGENERATE_INPUT)
    }
  })

  it('downgrades an ENTER whose stop equals entry (zero-width stop) to NONE + DEGENERATE_INPUT', () => {
    const guarded = guardDecision({ kind: 'ENTER', side: 'long', entry: 100, stop: 100, score: 0.5, reasonCodes: [] })
    expect(guarded).toEqual({ kind: 'NONE', reasonCodes: [DEGENERATE_INPUT, 'zero_width_stop'] })
  })

  it('downgrades a non-finite ADJUST_STOP to NONE + DEGENERATE_INPUT', () => {
    const guarded = guardDecision({ kind: 'ADJUST_STOP', newStop: NaN })
    expect(guarded.kind).toBe('NONE')
  })

  it('leaves EXIT and well-formed NONE untouched', () => {
    expect(guardDecision({ kind: 'EXIT', reasonCodes: ['x'] })).toEqual({ kind: 'EXIT', reasonCodes: ['x'] })
    expect(guardDecision({ kind: 'NONE' })).toEqual({ kind: 'NONE' })
  })
})

describe('withDegenerateGuard', () => {
  it('wraps a strategy so a NaN-producing implementation cannot reach callers as ENTER', () => {
    const brokenStrategy: Strategy = {
      id: 'broken',
      version: '0.0.0',
      paramsSchema: {} as never,
      warmup: () => [],
      evaluate: () => ({ kind: 'ENTER', side: 'long', entry: 0 / 0, stop: 1, score: 0.5, reasonCodes: [] }),
    }
    const guarded = withDegenerateGuard(brokenStrategy)
    const decision = guarded.evaluate({ bars: [], interval: '1d', params: {} })
    expect(decision.kind).toBe('NONE')
    expect((decision as { reasonCodes?: string[] }).reasonCodes).toContain(DEGENERATE_INPUT)
  })
})
