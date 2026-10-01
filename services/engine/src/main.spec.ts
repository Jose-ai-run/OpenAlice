import { describe, expect, it } from 'vitest'
import { createApp } from './main.js'
import { openDatabase } from './db/database.js'
import { runMigrations } from './db/migrate.js'
import { migrations } from './db/migrations/0001-init.js'
import { Journal } from './journal/journal.js'
import type { EngineConfig } from './config/engine-config.js'

describe('engine health route (Fase 1 skeleton)', () => {
  it('GET /engine/health responds ok with a startedAt timestamp', async () => {
    const startedAt = new Date().toISOString()
    const app = createApp(startedAt)

    const res = await app.request('/engine/health')

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; startedAt: string }
    expect(body.ok).toBe(true)
    expect(body.startedAt).toBe(startedAt)
  })

  it('without statusDeps, /engine/status 404s — exactly Fase 1 behavior, unchanged', async () => {
    const app = createApp(new Date().toISOString())
    const res = await app.request('/engine/status')
    expect(res.status).toBe(404)
  })
})

describe('engine status route (Hito 1 Parte 2, item 3d)', () => {
  function makeConfig(): EngineConfig {
    return {
      mode: 'PAPER', interval: '1h', historyBars: 10,
      strategy: { id: 'trend-following', params: {} },
      universe: [{ label: 'BTC', utaId: 'bybit-readonly', aliceId: 'bybit-readonly|BTC/USDT:USDT' }],
      paperAccountId: 'engine-paper',
    }
  }

  it('GET /engine/status answers with the instrument mapping and empty decisions when statusDeps are supplied', async () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)
    const journal = new Journal(db)
    const app = createApp(new Date().toISOString(), { config: makeConfig(), journal, utaBaseUrl: 'http://127.0.0.1:1' })

    const res = await app.request('/engine/status')
    expect(res.status).toBe(200)
    const body = await res.json() as { instrumentMapping: Array<{ executionAliceId: string }>; recentDecisions: unknown[] }
    expect(body.instrumentMapping).toEqual([{ label: 'BTC', aliceId: 'bybit-readonly|BTC/USDT:USDT', executionAliceId: 'engine-paper|BTC/USDT:USDT' }])
    expect(body.recentDecisions).toEqual([])
  })

  it('GET / renders an HTML dashboard', async () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)
    const journal = new Journal(db)
    const app = createApp(new Date().toISOString(), { config: makeConfig(), journal, utaBaseUrl: 'http://127.0.0.1:1' })

    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const html = await res.text()
    expect(html).toContain('Engine status')
    expect(html).toContain('engine-paper|BTC/USDT:USDT')
  })
})
