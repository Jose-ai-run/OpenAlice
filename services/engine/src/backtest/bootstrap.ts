/**
 * [PROPUESTA] F6 bootstrap (ADR-0011 §5.2/§5.5). Deterministic given an
 * injected RNG (tests pass a seeded one; production uses Math.random) —
 * pure resampling-with-replacement over an array of per-trade values.
 */

export interface BootstrapOptions {
  iterations: number
  /** Lower percentile to report, e.g. 2.5 for a 95% CI, 0.05*100/N for the Bonferroni-adjusted one (ADR-0011 §5.5). */
  lowerPercentile: number
  rng?: () => number
}

/** Resamples `values` with replacement `iterations` times, computing `statistic` (default: mean) each time, and returns the requested lower percentile of the resampled statistic distribution. */
export function bootstrapLowerBound(
  values: readonly number[], options: BootstrapOptions, statistic: (sample: number[]) => number = mean,
): number {
  if (values.length === 0) return NaN
  const rng = options.rng ?? Math.random
  const results: number[] = []
  for (let i = 0; i < options.iterations; i++) {
    const sample: number[] = []
    for (let j = 0; j < values.length; j++) {
      sample.push(values[Math.floor(rng() * values.length)]!)
    }
    results.push(statistic(sample))
  }
  results.sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(results.length - 1, Math.floor((options.lowerPercentile / 100) * results.length)))
  return results[idx]!
}

export function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

export function stddevOf(values: readonly number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1))
}

/** Sharpe of one resample: mean/stddev of the sample itself (no annualization — the caller scales by sqrt(tradesPerYear) separately, same as metrics.ts). */
export function sharpeStatistic(sample: number[]): number {
  const sd = stddevOf(sample)
  return sd > 0 ? mean(sample) / sd : 0
}

/** Simple deterministic PRNG (mulberry32) for reproducible tests/runs — never Math.random in a test. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
