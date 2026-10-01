/**
 * [PROPUESTA] F6 (ADR-0011 §1/§9) — persisted bar storage. One row per
 * (source, symbol, interval, open_time); `upsertBars` is idempotent
 * (INSERT OR REPLACE keyed by the real primary key), so re-running the
 * downloader never duplicates rows.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { Bar, BarInterval } from '@traderalice/uta-protocol'
import { hashBars } from './hash.js'

export function upsertBars(db: DatabaseSync, source: string, symbol: string, interval: BarInterval, bars: readonly Bar[]): void {
  const stmt = db.prepare(`
    INSERT INTO market_bars (source, symbol, interval, open_time, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, symbol, interval, open_time) DO UPDATE SET
      open = excluded.open, high = excluded.high, low = excluded.low,
      close = excluded.close, volume = excluded.volume
  `)
  for (const bar of bars) {
    stmt.run(source, symbol, interval, bar.timestamp.toISOString(), bar.open, bar.high, bar.low, bar.close, bar.volume)
  }
}

export function readBars(db: DatabaseSync, source: string, symbol: string, interval: BarInterval): Bar[] {
  const rows = db.prepare(`
    SELECT open_time, open, high, low, close, volume FROM market_bars
    WHERE source = ? AND symbol = ? AND interval = ?
    ORDER BY open_time ASC
  `).all(source, symbol, interval) as Array<{ open_time: string; open: string; high: string; low: string; close: string; volume: string }>
  return rows.map((r) => ({
    timestamp: new Date(r.open_time), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
  }))
}

export function recordDataset(
  db: DatabaseSync, source: string, symbol: string, interval: BarInterval, bars: readonly Bar[], fetchedAt: Date,
): { datasetHash: string; barCount: number } {
  const datasetHash = hashBars(bars)
  db.prepare(`
    INSERT INTO datasets (source, symbol, interval, dataset_hash, bar_count, earliest_open_time, latest_open_time, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    source, symbol, interval, datasetHash, bars.length,
    bars[0]?.timestamp.toISOString() ?? '', bars[bars.length - 1]?.timestamp.toISOString() ?? '',
    fetchedAt.toISOString(),
  )
  return { datasetHash, barCount: bars.length }
}

/**
 * Derives 4h bars from 1h bars already in the store — never downloaded
 * separately (ADR-0011 §1), so both intervals are consistent by
 * construction. Groups 4 consecutive closed 1h bars aligned to 4h UTC
 * boundaries (00:00/04:00/08:00/...); a partial trailing group (fewer
 * than 4 bars, e.g. the most recent incomplete 4h window) is dropped.
 */
export function deriveFourHourBars(oneHourBars: readonly Bar[]): Bar[] {
  const FOUR_HOUR_MS = 4 * 60 * 60 * 1000
  const groups = new Map<number, Bar[]>()
  for (const bar of oneHourBars) {
    const bucketStart = Math.floor(bar.timestamp.getTime() / FOUR_HOUR_MS) * FOUR_HOUR_MS
    const group = groups.get(bucketStart) ?? []
    group.push(bar)
    groups.set(bucketStart, group)
  }
  const result: Bar[] = []
  for (const [bucketStart, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length !== 4) continue  // incomplete window (data gap or trailing partial) — drop, don't fabricate
    const sorted = [...group].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    const high = Math.max(...sorted.map((b) => Number(b.high)))
    const low = Math.min(...sorted.map((b) => Number(b.low)))
    const volume = sorted.reduce((sum, b) => sum + Number(b.volume), 0)
    result.push({
      timestamp: new Date(bucketStart),
      open: sorted[0]!.open,
      high: String(high),
      low: String(low),
      close: sorted[3]!.close,
      volume: String(volume),
    })
  }
  return result
}
