import type { Bar, BarInterval } from '@traderalice/uta-protocol'
import { intervalToMs } from './interval.js'

export interface DuplicateFinding {
  index: number
  timestamp: string
}

export interface GapFinding {
  afterIndex: number
  expectedTimestamp: string
  actualTimestamp: string
  missingBars: number
}

export interface InvalidOhlcFinding {
  index: number
  reason: string
}

export interface QualityReport {
  inspected: number
  duplicates: DuplicateFinding[]
  gaps: GapFinding[]
  invalidOhlc: InvalidOhlcFinding[]
}

function isFiniteDecimalString(value: string): boolean {
  const n = Number(value)
  return Number.isFinite(n)
}

/**
 * PROMPT_MASTER_CLAUDE_CODE.md §37 F2: "tests de huecos, duplicados y barra
 * abierta". Pure function — no I/O, no clock reads (freshness is separate,
 * see freshness.ts, precisely so this stays a pure quality inspection).
 */
export function checkBarQuality(bars: readonly Bar[], interval: BarInterval): QualityReport {
  const stepMs = intervalToMs(interval)
  const duplicates: DuplicateFinding[] = []
  const gaps: GapFinding[] = []
  const invalidOhlc: InvalidOhlcFinding[] = []

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!
    const reasons: string[] = []
    if (!isFiniteDecimalString(bar.open)) reasons.push('open is not a finite number')
    if (!isFiniteDecimalString(bar.high)) reasons.push('high is not a finite number')
    if (!isFiniteDecimalString(bar.low)) reasons.push('low is not a finite number')
    if (!isFiniteDecimalString(bar.close)) reasons.push('close is not a finite number')
    if (!isFiniteDecimalString(bar.volume)) reasons.push('volume is not a finite number')
    if (reasons.length === 0) {
      const [open, high, low, close] = [Number(bar.open), Number(bar.high), Number(bar.low), Number(bar.close)]
      if (high < low) reasons.push('high < low')
      if (open > high || open < low) reasons.push('open outside [low, high]')
      if (close > high || close < low) reasons.push('close outside [low, high]')
    }
    if (reasons.length > 0) invalidOhlc.push({ index: i, reason: reasons.join('; ') })

    if (i === 0) continue
    const prev = bars[i - 1]!
    const deltaMs = bar.timestamp.getTime() - prev.timestamp.getTime()

    if (deltaMs === 0) {
      duplicates.push({ index: i, timestamp: bar.timestamp.toISOString() })
      continue
    }
    if (deltaMs > stepMs) {
      const missingBars = Math.round(deltaMs / stepMs) - 1
      if (missingBars > 0) {
        gaps.push({
          afterIndex: i - 1,
          expectedTimestamp: new Date(prev.timestamp.getTime() + stepMs).toISOString(),
          actualTimestamp: bar.timestamp.toISOString(),
          missingBars,
        })
      }
    }
  }

  return { inspected: bars.length, duplicates, gaps, invalidOhlc }
}

/**
 * PROMPT_MASTER_CLAUDE_CODE.md §17: "solo barras cerradas" — a bar is still
 * open while `now` falls before its close time (open time + interval).
 */
export function isBarClosed(bar: Bar, interval: BarInterval, now: Date): boolean {
  return now.getTime() >= bar.timestamp.getTime() + intervalToMs(interval)
}

/** Drops any trailing bar(s) that have not closed yet, per `isBarClosed`. */
export function dropOpenBars(bars: readonly Bar[], interval: BarInterval, now: Date): Bar[] {
  const closed = [...bars]
  while (closed.length > 0 && !isBarClosed(closed[closed.length - 1]!, interval, now)) {
    closed.pop()
  }
  return closed
}
