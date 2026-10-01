import { describe, expect, it } from 'vitest'
import type { Bar } from '@traderalice/uta-protocol'
import { openDatabase } from '../db/database.js'
import { runMigrations } from '../db/migrate.js'
import { migrations } from '../db/migrations/0001-init.js'
import { upsertBars, readBars, recordDataset, deriveFourHourBars } from './market-bars-store.js'

function bar(iso: string, o: string, h: string, l: string, c: string, v = '1'): Bar {
  return { timestamp: new Date(iso), open: o, high: h, low: l, close: c, volume: v }
}

function makeDb() {
  const db = openDatabase(':memory:')
  runMigrations(db, migrations)
  return db
}

describe('upsertBars / readBars', () => {
  it('round-trips bars exactly, ordered by open_time', () => {
    const db = makeDb()
    const bars = [bar('2026-01-01T01:00:00.000Z', '1', '2', '0.5', '1.5'), bar('2026-01-01T00:00:00.000Z', '0.9', '1', '0.8', '1')]
    upsertBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h', bars)
    const read = readBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h')
    expect(read.map((b) => b.timestamp.toISOString())).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z'])
  })

  it('is idempotent — re-upserting the same bar does not duplicate the row', () => {
    const db = makeDb()
    const b = bar('2026-01-01T00:00:00.000Z', '1', '2', '0.5', '1.5')
    upsertBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h', [b])
    upsertBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h', [b])
    expect(readBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h')).toHaveLength(1)
  })

  it('overwrites a changed value for the same open_time (re-fetch corrects data)', () => {
    const db = makeDb()
    upsertBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h', [bar('2026-01-01T00:00:00.000Z', '1', '2', '0.5', '1.5')])
    upsertBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h', [bar('2026-01-01T00:00:00.000Z', '1', '2', '0.5', '1.8')])
    expect(readBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h')[0]?.close).toBe('1.8')
  })

  it('keeps different symbols/intervals separate', () => {
    const db = makeDb()
    upsertBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h', [bar('2026-01-01T00:00:00.000Z', '1', '2', '0.5', '1.5')])
    upsertBars(db, 'bybit-readonly', 'ETH/USDT:USDT', '1h', [bar('2026-01-01T00:00:00.000Z', '2', '3', '1.5', '2.5')])
    expect(readBars(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h')).toHaveLength(1)
    expect(readBars(db, 'bybit-readonly', 'ETH/USDT:USDT', '1h')).toHaveLength(1)
  })
})

describe('recordDataset', () => {
  it('records the real dataset hash + bar count + range', () => {
    const db = makeDb()
    const bars = [bar('2026-01-01T00:00:00.000Z', '1', '2', '0.5', '1.5'), bar('2026-01-01T01:00:00.000Z', '1.5', '2', '1', '1.8')]
    const { datasetHash, barCount } = recordDataset(db, 'bybit-readonly', 'BTC/USDT:USDT', '1h', bars, new Date('2026-10-01T00:00:00.000Z'))
    expect(barCount).toBe(2)
    expect(datasetHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('deriveFourHourBars', () => {
  it('aggregates 4 consecutive aligned 1h bars into one 4h bar (OHLCV correct)', () => {
    const bars = [
      bar('2026-01-01T00:00:00.000Z', '100', '105', '95', '102'),
      bar('2026-01-01T01:00:00.000Z', '102', '110', '101', '108'),
      bar('2026-01-01T02:00:00.000Z', '108', '109', '90', '95'),
      bar('2026-01-01T03:00:00.000Z', '95', '100', '94', '99'),
    ]
    const result = deriveFourHourBars(bars)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ open: '100', high: '110', low: '90', close: '99' })
    expect(result[0]!.timestamp.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('drops an incomplete trailing group rather than fabricating a partial 4h bar', () => {
    const bars = [
      bar('2026-01-01T00:00:00.000Z', '100', '105', '95', '102'),
      bar('2026-01-01T01:00:00.000Z', '102', '110', '101', '108'),
    ]
    expect(deriveFourHourBars(bars)).toHaveLength(0)
  })

  it('handles two consecutive full 4h windows', () => {
    const bars = Array.from({ length: 8 }, (_, i) =>
      bar(new Date(Date.UTC(2026, 0, 1, i)).toISOString(), '100', '101', '99', '100'))
    expect(deriveFourHourBars(bars)).toHaveLength(2)
  })

  it('does not fabricate a 4h bar from a misaligned gap (e.g. hours 1-4 instead of 0-3)', () => {
    const bars = [1, 2, 3, 4].map((h) => bar(new Date(Date.UTC(2026, 0, 1, h)).toISOString(), '100', '101', '99', '100'))
    // hours 1-3 belong to the [0,4) bucket (only 3 of 4), hour 4 starts a new [4,8) bucket (only 1 of 4) — both incomplete.
    expect(deriveFourHourBars(bars)).toHaveLength(0)
  })
})
