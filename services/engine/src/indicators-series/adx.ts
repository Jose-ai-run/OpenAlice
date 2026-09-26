/**
 * [PROPUESTA] ADX (Average Directional Index), Wilder's method — does NOT
 * exist under src/domain/analysis/indicator/functions/ (confirmed absent in
 * Fase 0: no *adx* file there). New implementation, standard Wilder
 * formulation:
 *
 *   +DM[i] = upMove   if upMove > downMove and upMove > 0,   else 0
 *   -DM[i] = downMove if downMove > upMove and downMove > 0, else 0
 *     where upMove = high[i]-high[i-1], downMove = low[i-1]-low[i]
 *   TR[i]  = max(high[i]-low[i], |high[i]-close[i-1]|, |low[i]-close[i-1]|)
 *   Smoothed TR / +DM / -DM: Wilder smoothing (first = sum of first `period`
 *     raw values; then smoothed = prev - prev/period + current).
 *   +DI = 100 * smoothed(+DM) / smoothed(TR)
 *   -DI = 100 * smoothed(-DM) / smoothed(TR)
 *   DX  = 100 * |+DI - -DI| / (+DI + -DI)
 *   ADX = Wilder-smoothed average of DX (first = simple average of the
 *     first `period` DX values; then Wilder smoothing thereafter).
 *
 * Verified in adx.spec.ts to 1e-9 against an independently written,
 * differently-structured reference computation (plain loops, no shared
 * helpers with this file) over a hand-traceable 10-bar fixture.
 */
export function adxSeries(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period: number,
): (number | null)[] {
  const n = highs.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (n < 1) return out

  const tr: number[] = []
  const plusDM: number[] = []
  const minusDM: number[] = []
  for (let i = 1; i < n; i++) {
    const upMove = highs[i]! - highs[i - 1]!
    const downMove = lows[i - 1]! - lows[i]!
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
    tr.push(Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    ))
  }
  // tr[k] / plusDM[k] / minusDM[k] correspond to bar index k+1.
  if (tr.length < period) return out

  const smTR = wilderSmoothSum(tr, period)
  const smPlusDM = wilderSmoothSum(plusDM, period)
  const smMinusDM = wilderSmoothSum(minusDM, period)
  // smX[0] corresponds to tr index (period-1) -> bar index period.

  const dx: number[] = smTR.map((t, i) => {
    const plusDI = 100 * (smPlusDM[i]! / t)
    const minusDI = 100 * (smMinusDM[i]! / t)
    return 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI)
  })
  if (dx.length < period) return out

  const adx: number[] = []
  let sum = 0
  for (let i = 0; i < period; i++) sum += dx[i]!
  adx.push(sum / period)
  for (let i = period; i < dx.length; i++) {
    adx.push((adx[adx.length - 1]! * (period - 1) + dx[i]!) / period)
  }
  // adx[0] corresponds to dx index (period-1) -> smX index (period-1)
  // -> tr index (2*period-2) -> bar index (2*period-1).
  const firstAdxBarIndex = 2 * period - 1
  for (let i = 0; i < adx.length; i++) {
    const barIndex = firstAdxBarIndex + i
    if (barIndex < n) out[barIndex] = adx[i]!
  }
  return out
}

/** Wilder smoothing: first = sum of first `period` values, then recursive. */
function wilderSmoothSum(values: readonly number[], period: number): number[] {
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]!
  out.push(sum)
  for (let i = period; i < values.length; i++) {
    sum = out[out.length - 1]! - out[out.length - 1]! / period + values[i]!
    out.push(sum)
  }
  return out
}
