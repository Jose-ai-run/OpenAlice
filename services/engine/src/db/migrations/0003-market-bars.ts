/**
 * [PROPUESTA] Migration 0003 — F6 backtesting (ADR-0011 §1/§9). Persisted
 * OHLCV bars, one row per (source, symbol, interval, open_time), with the
 * dataset hash (hash.ts, sha256) so every walk-forward variant reads the
 * SAME downloaded dataset instead of re-fetching per variant.
 */
import type { Migration } from '../migrate.js'

export const migration0003MarketBars: Migration = {
  id: 3,
  name: 'market_bars',
  up(db) {
    db.exec(`
      CREATE TABLE market_bars (
        source TEXT NOT NULL,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        open_time TEXT NOT NULL,
        open TEXT NOT NULL,
        high TEXT NOT NULL,
        low TEXT NOT NULL,
        close TEXT NOT NULL,
        volume TEXT NOT NULL,
        PRIMARY KEY (source, symbol, interval, open_time)
      );
      CREATE INDEX idx_market_bars_lookup ON market_bars(source, symbol, interval, open_time);

      CREATE TABLE datasets (
        dataset_id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        dataset_hash TEXT NOT NULL,
        bar_count INTEGER NOT NULL,
        earliest_open_time TEXT NOT NULL,
        latest_open_time TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX idx_datasets_lookup ON datasets(source, symbol, interval);
    `)
  },
}
