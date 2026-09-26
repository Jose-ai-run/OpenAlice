import { adxSeries } from '../indicators-series/adx.js'
import type { Bar } from '@traderalice/uta-protocol'

export type Regime = 'trending' | 'ranging' | 'unknown'

/** ADX-threshold regime classification — pure, no lookahead (one ADX value in, one regime out). */
export function classifyRegime(adxValue: number | null, threshold: number): Regime {
  if (adxValue == null) return 'unknown'
  return adxValue >= threshold ? 'trending' : 'ranging'
}

/** Series form: classifies every bar from its own ADX value at that index. */
export function classifyRegimeSeries(bars: readonly Bar[], adxPeriod: number, threshold: number): Regime[] {
  const highs = bars.map((b) => Number(b.high))
  const lows = bars.map((b) => Number(b.low))
  const closes = bars.map((b) => Number(b.close))
  const adx = adxSeries(highs, lows, closes, adxPeriod)
  return adx.map((v) => classifyRegime(v, threshold))
}
