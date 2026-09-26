/**
 * [PROPUESTA] Series helper — PROMPT_MASTER_CLAUDE_CODE.md §7/§11: existing
 * indicators under src/domain/analysis/indicator/functions/ return only the
 * latest value (e.g. `SMA(data, period): number`,
 * src/domain/analysis/indicator/functions/statistics.ts:14). Strategies need
 * the value AT EVERY HISTORICAL POINT to evaluate purely and without
 * lookahead, so this module mirrors the same arithmetic in series form
 * rather than calling the scalar function in a loop (O(n·period) either way,
 * but avoids re-deriving the same NumericInput coercion per call).
 *
 * Same formula as statistics.ts SMA(): mean of the trailing `period` values.
 */
export function smaSeries(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!
    if (i >= period) sum -= values[i - period]!
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}
