import type { Bar } from '@traderalice/uta-protocol'

export interface Freshness {
  latestBarTimestamp: string | null
  /** Seconds between `now` and the latest bar's open time. Null if no bars. */
  dataAgeSeconds: number | null
}

/** PROMPT_MASTER_CLAUDE_CODE.md §17: "`data_age_seconds` en cada snapshot". */
export function measureFreshness(bars: readonly Bar[], now: Date): Freshness {
  if (bars.length === 0) return { latestBarTimestamp: null, dataAgeSeconds: null }
  const latest = bars[bars.length - 1]!
  return {
    latestBarTimestamp: latest.timestamp.toISOString(),
    dataAgeSeconds: Math.max(0, Math.round((now.getTime() - latest.timestamp.getTime()) / 1000)),
  }
}
