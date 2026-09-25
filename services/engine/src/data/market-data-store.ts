import type { Bar, BarInterval } from '@traderalice/uta-protocol'
import type { EngineUtaClient, HistoricalBarsRequest } from '../uta/uta-client.js'
import { hashBars } from './hash.js'
import { checkBarQuality, dropOpenBars, type QualityReport } from './quality.js'
import { measureFreshness, type Freshness } from './freshness.js'

export interface BarDataset {
  source: string
  symbol: string
  interval: BarInterval
  bars: Bar[]
  /** sha256 over the returned (closed-bars-only) dataset — same input, same hash. */
  hash: string
  fetchedAt: string
  quality: QualityReport
  freshness: Freshness
}

export interface GetBarsRequest {
  utaId: string
  /** Cache/identity key — typically the same as contract.aliceId. */
  symbol: string
  contract: HistoricalBarsRequest['contract']
  interval: BarInterval
  limit?: number
  start?: Date
  end?: Date
}

export interface MarketDataStoreOptions {
  client: EngineUtaClient
  /** Injectable clock for hermetic, no-lookahead-safe tests. */
  now?: () => Date
}

/**
 * [PROPUESTA] MarketDataStore (PROMPT_MASTER_CLAUDE_CODE.md §6/§17).
 *
 * Fase 2 scope: fetch + validate + cache in memory, keyed by
 * `source|symbol|interval`. Persisting to the `market_bars` SQLite table
 * (§8) is deferred to the fase that implements src/db/ (ADR-0002) — this
 * store's public shape (BarDataset) is exactly what a later persistence
 * layer would write, so wiring SQLite in later doesn't change this API.
 */
export class MarketDataStore {
  private readonly client: EngineUtaClient
  private readonly now: () => Date
  private readonly cache = new Map<string, BarDataset>()

  constructor(options: MarketDataStoreOptions) {
    this.client = options.client
    this.now = options.now ?? (() => new Date())
  }

  private cacheKey(utaId: string, symbol: string, interval: BarInterval): string {
    return `${utaId}|${symbol}|${interval}`
  }

  /** Last dataset fetched for this key, if any — no network call. */
  peek(utaId: string, symbol: string, interval: BarInterval): BarDataset | undefined {
    return this.cache.get(this.cacheKey(utaId, symbol, interval))
  }

  async getBars(req: GetBarsRequest): Promise<BarDataset> {
    const raw = await this.client.getHistoricalBars({
      utaId: req.utaId,
      contract: req.contract,
      params: { interval: req.interval, limit: req.limit, start: req.start, end: req.end },
    })

    const now = this.now()
    const closed = dropOpenBars(raw, req.interval, now)
    const quality = checkBarQuality(closed, req.interval)

    const dataset: BarDataset = {
      source: req.utaId,
      symbol: req.symbol,
      interval: req.interval,
      bars: closed,
      hash: hashBars(closed),
      fetchedAt: now.toISOString(),
      quality,
      freshness: measureFreshness(closed, now),
    }

    this.cache.set(this.cacheKey(req.utaId, req.symbol, req.interval), dataset)
    return dataset
  }
}
