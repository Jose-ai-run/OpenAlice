/**
 * [PROPUESTA] F6 data downloader (ADR-0011 §1/§9, PROMPT_MASTER_CLAUDE_CODE.md
 * §37 F2). Paginates UTA's real `/historical` endpoint BACKWARD in time
 * (CcxtBroker caps each call at 5000 bars anchored to the trailing window —
 * see services/uta/src/domain/trading/brokers/ccxt/CcxtBroker.ts:1264) until
 * the venue stops returning new (older) bars, for BTC and ETH 1h on
 * bybit-readonly. Runs quality checks (checkBarQuality, Fase 2) and persists
 * to market_bars with a dataset hash (hashBars) — real network calls, real
 * data, no synthetic bars.
 */
import { resolve } from 'node:path'
import { openDatabase } from '../db/database.js'
import { runMigrations } from '../db/migrate.js'
import { migrations } from '../db/migrations/0001-init.js'
import { EngineUtaClient } from '../uta/uta-client.js'
import { checkBarQuality } from '../data/quality.js'
import { upsertBars, recordDataset, deriveFourHourBars } from '../data/market-bars-store.js'
import type { Bar } from '@traderalice/uta-protocol'

const UTA_ID = 'bybit-readonly'
const SYMBOLS = [
  { label: 'BTC/USDT perp (Bybit)', aliceId: 'bybit-readonly|BTC/USDT:USDT' },
  { label: 'ETH/USDT perp (Bybit)', aliceId: 'bybit-readonly|ETH/USDT:USDT' },
]

async function downloadAllHistory(client: EngineUtaClient, aliceId: string): Promise<Bar[]> {
  const byTime = new Map<number, Bar>()
  let end = new Date()
  let page = 0
  for (;;) {
    page++
    const batch = await client.getHistoricalBars({
      utaId: UTA_ID, contract: { aliceId }, params: { interval: '1h', limit: 5000, end },
    })
    if (batch.length === 0) break
    let addedNew = false
    for (const bar of batch) {
      const t = bar.timestamp.getTime()
      if (!byTime.has(t)) { byTime.set(t, bar); addedNew = true }
    }
    const earliest = batch.reduce((min, b) => Math.min(min, b.timestamp.getTime()), Infinity)
    console.log(`[download] ${aliceId} page ${page}: ${batch.length} bars, earliest=${new Date(earliest).toISOString()}, total so far=${byTime.size}`)
    if (!addedNew || batch.length < 2) break  // venue has no older data left
    end = new Date(earliest - 1)
  }
  return [...byTime.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

async function main(): Promise<void> {
  const dbPath = process.argv[2] ?? resolve(import.meta.dirname, '../../data/backtest.db')
  const utaBaseUrl = process.env['OPENALICE_UTA_URL'] ?? 'http://127.0.0.1:47333'

  const db = openDatabase(dbPath)
  runMigrations(db, migrations)
  const client = new EngineUtaClient({ baseUrl: utaBaseUrl })

  for (const { label, aliceId } of SYMBOLS) {
    console.log(`\n[download] === ${label} (${aliceId}) — 1h, paginando hacia atrás ===`)
    const bars = await downloadAllHistory(client, aliceId)
    if (bars.length === 0) throw new Error(`NO ENCONTRADO: cero velas reales devueltas para ${aliceId}`)

    const quality = checkBarQuality(bars, '1h')
    console.log(`[download] ${aliceId}: ${bars.length} velas 1h reales, ${bars[0]!.timestamp.toISOString()} .. ${bars[bars.length - 1]!.timestamp.toISOString()}`)
    console.log(`[download] calidad: duplicados=${quality.duplicates.length} huecos=${quality.gaps.length} OHLC_invalido=${quality.invalidOhlc.length}`)
    if (quality.invalidOhlc.length > 0) {
      throw new Error(`[download] FALLO de calidad: ${quality.invalidOhlc.length} velas con OHLC inválido en ${aliceId} — no se persiste un dataset corrupto`)
    }

    upsertBars(db, UTA_ID, aliceId, '1h', bars)
    const { datasetHash, barCount } = recordDataset(db, UTA_ID, aliceId, '1h', bars, new Date())
    console.log(`[download] persistido: ${barCount} velas 1h, datasetHash=${datasetHash}`)

    const fourHour = deriveFourHourBars(bars)
    upsertBars(db, UTA_ID, aliceId, '4h', fourHour)
    const ds4h = recordDataset(db, UTA_ID, aliceId, '4h', fourHour, new Date())
    console.log(`[download] derivado: ${ds4h.barCount} velas 4h (agregadas de 1h, nunca descargadas aparte), datasetHash=${ds4h.datasetHash}`)
  }

  console.log(`\n[download] done — ${dbPath}`)
}

main().catch((err) => {
  console.error('[download] fatal:', err)
  process.exit(1)
})
