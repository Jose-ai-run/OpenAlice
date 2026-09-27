/**
 * [PROPUESTA] Candle-aligned scheduler — Hito 1, item 1.
 *
 * Fires `onTick(closeAt)` once per interval boundary, with a margin after
 * the boundary so the venue has time to publish the closed candle (item 1:
 * "con margen para que el venue publique la vela").
 *
 * **No re-entry, by construction, not by a guard:** the next timer is
 * only scheduled from inside `onTick`'s `.finally()`, i.e. strictly
 * after the current cycle finishes — there is never a live timer for a
 * later boundary while a cycle is in flight, so two cycles overlapping
 * is not a state this scheduler can reach. The cost of that simplicity:
 * if a cycle runs long enough to cross one or more real boundaries, those
 * boundaries are never attempted at all (not queued, not caught up on) —
 * `onSkippedOverlap` reports each one that was skipped this way, computed
 * from the gap between the boundary just handled and the next one found
 * once the scheduler is free again, purely for observability (the status
 * page, item 6).
 *
 * Clock is injectable so tests never depend on real wall-clock time.
 */
import type { BarInterval } from '@traderalice/uta-protocol'
import type { Clock } from './clock.js'
import { systemClock } from './clock.js'
import { intervalMs, lastBoundaryAtOrBefore, msUntilNextTick } from './candle-boundaries.js'

export interface CandleSchedulerOptions {
  interval: BarInterval
  /** Wait this long after the boundary before firing — default 15s. */
  marginMs?: number
  clock?: Clock
  onTick: (closeAt: Date) => Promise<void>
  /** Called when onTick throws, or when a tick is skipped due to overlap. */
  onError?: (err: unknown) => void
  onSkippedOverlap?: (closeAt: Date) => void
  /** Injectable timer functions — tests use vi.useFakeTimers() via these. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface CandleScheduler {
  start(): void
  stop(): void
  /** True while a tick's onTick() call is in flight — exposed for tests. */
  isRunning(): boolean
}

export function createCandleScheduler(opts: CandleSchedulerOptions): CandleScheduler {
  const clock = opts.clock ?? systemClock
  const marginMs = opts.marginMs ?? 15_000
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]))

  let stopped = true
  let running = false
  let handle: unknown
  let lastHandledMs: number | undefined

  function scheduleNext(): void {
    if (stopped) return
    const now = clock.now()
    const delay = Math.max(0, msUntilNextTick(now, opts.interval, marginMs))
    handle = setTimer(fire, delay)
  }

  function fire(): void {
    if (stopped) return
    const now = clock.now()
    // The candle that just closed is the boundary at-or-before (now - margin),
    // not at-or-before `now` itself — `now` is already past the boundary by
    // ~marginMs when this fires.
    const closeAt = lastBoundaryAtOrBefore(new Date(now.getTime() - marginMs), opts.interval)

    if (lastHandledMs !== undefined) {
      const step = intervalMs(opts.interval)
      for (let t = lastHandledMs + step; t < closeAt.getTime(); t += step) {
        opts.onSkippedOverlap?.(new Date(t))
      }
    }
    lastHandledMs = closeAt.getTime()

    running = true
    void opts.onTick(closeAt)
      .catch((err) => opts.onError?.(err))
      .finally(() => {
        running = false
        scheduleNext()
      })
  }

  return {
    start(): void {
      if (!stopped) return
      stopped = false
      scheduleNext()
    },
    stop(): void {
      stopped = true
      if (handle !== undefined) clearTimer(handle)
    },
    isRunning: () => running,
  }
}
