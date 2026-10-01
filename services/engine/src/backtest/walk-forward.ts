/**
 * [PROPUESTA] F6 walk-forward splitter (ADR-0011 §4). Pure — operates on
 * bar timestamps only, no strategy evaluation here. 12-month IS / 3-month
 * OOS, rolling forward 3 months per step; the last 6 months of the
 * dataset are reserved as the holdout and never appear in any WF fold.
 *
 * "Months" are calendar months added via `Date.UTC` month arithmetic
 * (not fixed 30-day blocks), so each fold's calendar length is real.
 */
import type { Bar } from '@traderalice/uta-protocol'

export interface WalkForwardFold {
  index: number
  isStart: Date
  isEnd: Date
  oosStart: Date
  oosEnd: Date
}

function addMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours()))
}

/** Bars strictly within [start, end). */
export function sliceByTime(bars: readonly Bar[], start: Date, end: Date): Bar[] {
  return bars.filter((b) => b.timestamp.getTime() >= start.getTime() && b.timestamp.getTime() < end.getTime())
}

export interface WalkForwardPlan {
  folds: WalkForwardFold[]
  holdoutStart: Date
  holdoutEnd: Date
}

export function planWalkForward(bars: readonly Bar[], isMonths = 12, oosMonths = 3, holdoutMonths = 6): WalkForwardPlan {
  if (bars.length === 0) return { folds: [], holdoutStart: new Date(0), holdoutEnd: new Date(0) }
  const datasetStart = bars[0]!.timestamp
  const datasetEnd = new Date(bars[bars.length - 1]!.timestamp.getTime() + 1)  // exclusive upper bound
  const holdoutStart = addMonths(datasetEnd, -holdoutMonths)

  const folds: WalkForwardFold[] = []
  let isStart = datasetStart
  let index = 0
  for (;;) {
    const isEnd = addMonths(isStart, isMonths)
    const oosStart = isEnd
    const oosEnd = addMonths(oosStart, oosMonths)
    if (oosEnd.getTime() > holdoutStart.getTime()) break  // this fold's OOS would bleed into the holdout — stop
    folds.push({ index, isStart, isEnd, oosStart, oosEnd })
    isStart = addMonths(isStart, oosMonths)  // roll forward by the OOS step
    index++
  }
  return { folds, holdoutStart, holdoutEnd: datasetEnd }
}
