import { describe, expect, it } from 'vitest'
import { createCandleScheduler } from './scheduler.js'
import type { Clock } from './clock.js'

/**
 * Manual fake-timer harness — deliberately not `vi.useFakeTimers()`, so
 * the scheduler's own `setTimer`/`clearTimer` injection points (built
 * for exactly this) are what's under test, not a global timer mock.
 */
function makeHarness() {
  let now = new Date('2026-09-27T14:00:00.000Z').getTime()
  const queue: Array<{ id: number; fireAt: number; fn: () => void }> = []
  let nextId = 1

  const clock: Clock = { now: () => new Date(now) }
  const setTimer = (fn: () => void, ms: number): number => {
    const id = nextId++
    queue.push({ id, fireAt: now + ms, fn })
    return id
  }
  const clearTimer = (id: unknown): void => {
    const idx = queue.findIndex((t) => t.id === id)
    if (idx >= 0) queue.splice(idx, 1)
  }

  /** Flush enough microtask hops for an async onTick's await/.catch/.finally
   *  chain to fully settle (including scheduleNext() running inside
   *  .finally) — used after manually resolving a blocked onTick. */
  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  /** Advance time by ms, firing any due timers in order (one at a time,
   *  so a timer scheduled by a fired callback can itself fire within the
   *  same advance if it's already due). */
  async function advance(ms: number): Promise<void> {
    const target = now + ms
    for (;;) {
      queue.sort((a, b) => a.fireAt - b.fireAt)
      const due = queue.find((t) => t.fireAt <= target)
      if (!due) break
      now = due.fireAt
      clearTimer(due.id)
      due.fn()
      await Promise.resolve()  // let the async onTick's microtasks settle
      await Promise.resolve()
    }
    now = target
  }

  return { clock, setTimer, clearTimer, advance, flushMicrotasks }
}

describe('createCandleScheduler', () => {
  it('fires once per boundary, with the publication margin applied', async () => {
    const h = makeHarness()
    const ticks: string[] = []
    const scheduler = createCandleScheduler({
      interval: '1h',
      marginMs: 15_000,
      clock: h.clock,
      setTimer: h.setTimer,
      clearTimer: h.clearTimer,
      onTick: async (closeAt) => { ticks.push(closeAt.toISOString()) },
    })
    scheduler.start()
    // 14:00:00 -> next boundary 15:00:00 + 15s margin = 1h 15s away
    await h.advance(60 * 60_000 + 15_000)
    expect(ticks).toEqual(['2026-09-27T15:00:00.000Z'])
    scheduler.stop()
  })

  it('fires three consecutive boundaries in order', async () => {
    const h = makeHarness()
    const ticks: string[] = []
    const scheduler = createCandleScheduler({
      interval: '1h',
      marginMs: 15_000,
      clock: h.clock,
      setTimer: h.setTimer,
      clearTimer: h.clearTimer,
      onTick: async (closeAt) => { ticks.push(closeAt.toISOString()) },
    })
    scheduler.start()
    await h.advance(3 * (60 * 60_000 + 15_000) + 1_000)
    expect(ticks).toEqual([
      '2026-09-27T15:00:00.000Z',
      '2026-09-27T16:00:00.000Z',
      '2026-09-27T17:00:00.000Z',
    ])
    scheduler.stop()
  })

  it('never overlaps: a slow cycle blocks any next timer from existing at all, and the boundary it crosses is reported skipped once the scheduler frees up', async () => {
    const h = makeHarness()
    const started: string[] = []
    const skipped: string[] = []
    let releaseFirstTick: (() => void) | undefined
    const scheduler = createCandleScheduler({
      interval: '1h',
      marginMs: 15_000,
      clock: h.clock,
      setTimer: h.setTimer,
      clearTimer: h.clearTimer,
      onTick: async (closeAt) => {
        started.push(closeAt.toISOString())
        if (closeAt.toISOString() === '2026-09-27T15:00:00.000Z') {
          await new Promise<void>((resolve) => { releaseFirstTick = resolve })
        }
      },
      onSkippedOverlap: (closeAt) => { skipped.push(closeAt.toISOString()) },
    })
    scheduler.start()
    // Reach the first boundary — onTick blocks inside it (still "running").
    await h.advance(60 * 60_000 + 15_000)
    expect(started).toEqual(['2026-09-27T15:00:00.000Z'])
    expect(scheduler.isRunning()).toBe(true)

    // A full hour passes while the cycle is still blocked. No re-entry is
    // even possible: no timer for 16:00 was ever scheduled, because
    // scheduleNext() only runs once the current onTick finishes.
    await h.advance(60 * 60_000)
    expect(started).toEqual(['2026-09-27T15:00:00.000Z'])
    expect(skipped).toEqual([])

    // Release the first tick. scheduleNext() now runs with `now` already
    // past 16:00 — it schedules the NEXT real boundary (17:00), and when
    // that one fires, the gap since 15:00 reveals 16:00 was skipped.
    releaseFirstTick?.()
    await h.flushMicrotasks()
    await h.advance(60 * 60_000)
    expect(started).toEqual(['2026-09-27T15:00:00.000Z', '2026-09-27T17:00:00.000Z'])
    expect(skipped).toEqual(['2026-09-27T16:00:00.000Z'])
    scheduler.stop()
  })

  it('stop() prevents any further ticks', async () => {
    const h = makeHarness()
    const ticks: string[] = []
    const scheduler = createCandleScheduler({
      interval: '1h',
      clock: h.clock,
      setTimer: h.setTimer,
      clearTimer: h.clearTimer,
      onTick: async (closeAt) => { ticks.push(closeAt.toISOString()) },
    })
    scheduler.start()
    scheduler.stop()
    await h.advance(3 * 60 * 60_000)
    expect(ticks).toEqual([])
  })

  it('onError is called when onTick throws, and the scheduler keeps going', async () => {
    const h = makeHarness()
    const errors: unknown[] = []
    const ticks: string[] = []
    const scheduler = createCandleScheduler({
      interval: '1h',
      marginMs: 0,
      clock: h.clock,
      setTimer: h.setTimer,
      clearTimer: h.clearTimer,
      onTick: async (closeAt) => {
        if (closeAt.toISOString() === '2026-09-27T15:00:00.000Z') throw new Error('boom')
        ticks.push(closeAt.toISOString())
      },
      onError: (err) => { errors.push(err) },
    })
    scheduler.start()
    await h.advance(2 * 60 * 60_000)
    expect(errors).toHaveLength(1)
    expect(ticks).toEqual(['2026-09-27T16:00:00.000Z'])
  })
})
