import { describe, expect, it, vi } from 'vitest'
import type { Bar } from '@traderalice/uta-protocol'
import { MarketDataStore } from './market-data-store.js'
import { cleanDailyBars } from './test-fixtures.js'
import type { EngineUtaClient } from '../uta/uta-client.js'

function fakeClient(bars: Bar[]): EngineUtaClient {
  return { getHistoricalBars: vi.fn(async () => bars) } as unknown as EngineUtaClient
}

describe('MarketDataStore.getBars', () => {
  const NOW = new Date(Date.UTC(2026, 0, 10)) // well past all fixture bars' close

  it('fetching the same bars twice produces the same hash', async () => {
    // Independent arrays with identical content, mirroring two real HTTP
    // round-trips that both return the venue's same historical data.
    const store1 = new MarketDataStore({ client: fakeClient(cleanDailyBars()), now: () => NOW })
    const store2 = new MarketDataStore({ client: fakeClient(cleanDailyBars()), now: () => NOW })

    const a = await store1.getBars({ utaId: 'bybit-readonly', symbol: 'bybit-BTCUSDT', contract: { aliceId: 'bybit-BTCUSDT' }, interval: '1d' })
    const b = await store2.getBars({ utaId: 'bybit-readonly', symbol: 'bybit-BTCUSDT', contract: { aliceId: 'bybit-BTCUSDT' }, interval: '1d' })

    expect(a.hash).toBe(b.hash)
  })

  it('drops the trailing open bar before hashing/caching', async () => {
    const openNow = new Date(Date.UTC(2026, 0, 5, 12, 0)) // mid-day-5, day 5 bar still open
    const store = new MarketDataStore({ client: fakeClient(cleanDailyBars()), now: () => openNow })
    const dataset = await store.getBars({ utaId: 'bybit-readonly', symbol: 'bybit-BTCUSDT', contract: { aliceId: 'bybit-BTCUSDT' }, interval: '1d' })
    expect(dataset.bars).toHaveLength(4)
  })

  it('surfaces quality findings and measured freshness', async () => {
    const bars = cleanDailyBars()
    bars.splice(2, 1) // introduce a gap
    const store = new MarketDataStore({ client: fakeClient(bars), now: () => NOW })
    const dataset = await store.getBars({ utaId: 'bybit-readonly', symbol: 'bybit-BTCUSDT', contract: { aliceId: 'bybit-BTCUSDT' }, interval: '1d' })
    expect(dataset.quality.gaps).toHaveLength(1)
    expect(dataset.freshness.dataAgeSeconds).toBeGreaterThan(0)
  })

  it('caches the last dataset per utaId+symbol+interval, readable via peek without a new fetch', async () => {
    const client = fakeClient(cleanDailyBars())
    const store = new MarketDataStore({ client, now: () => NOW })
    expect(store.peek('bybit-readonly', 'bybit-BTCUSDT', '1d')).toBeUndefined()
    await store.getBars({ utaId: 'bybit-readonly', symbol: 'bybit-BTCUSDT', contract: { aliceId: 'bybit-BTCUSDT' }, interval: '1d' })
    expect(store.peek('bybit-readonly', 'bybit-BTCUSDT', '1d')).toBeDefined()
    expect(client.getHistoricalBars).toHaveBeenCalledTimes(1)
  })
})
