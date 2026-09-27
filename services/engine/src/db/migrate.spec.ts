import { describe, expect, it } from 'vitest'
import { openDatabase } from './database.js'
import { runMigrations, type Migration } from './migrate.js'
import { migrations } from './migrations/0001-init.js'

describe('runMigrations', () => {
  it('applies migration 0001 cleanly to a fresh in-memory database', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      .map((r) => r['name'])
    expect(tables).toEqual(expect.arrayContaining(['cycles', 'decisions', 'order_intents', 'order_events', 'migrations']))
  })

  it('is idempotent — running twice does not re-apply or error', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)
    expect(() => runMigrations(db, migrations)).not.toThrow()
    const count = db.prepare('SELECT COUNT(*) as n FROM migrations').get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('records applied migrations with a name and timestamp', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)
    const row = db.prepare('SELECT id, name, applied_at FROM migrations WHERE id = 1').get() as
      { id: number; name: string; applied_at: string }
    expect(row.name).toBe('init')
    expect(() => new Date(row.applied_at).toISOString()).not.toThrow()
  })

  it('a failing migration rolls back and never gets marked applied', () => {
    const db = openDatabase(':memory:')
    const broken: Migration = { id: 1, name: 'broken', up: (d) => { d.exec('CREATE TABLE x (bad syntax HERE') } }
    expect(() => runMigrations(db, [broken])).toThrow()
    const count = db.prepare('SELECT COUNT(*) as n FROM migrations').get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('the real cycles/decisions/order_intents/order_events schema accepts a real row each', () => {
    const db = openDatabase(':memory:')
    runMigrations(db, migrations)

    db.prepare(`INSERT INTO cycles (mode, interval, candle_close_at, started_at, status)
                VALUES ('SIGNAL_ONLY', '1h', '2026-09-27T15:00:00.000Z', '2026-09-27T15:00:15.000Z', 'running')`).run()
    const cycleId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }

    db.prepare(`INSERT INTO decisions (cycle_id, symbol, alice_id, strategy_id, strategy_version, kind, reason_codes, decision_json, created_at)
                VALUES (?, 'BTC/USDT:USDT', 'bybit-readonly|BTC/USDT:USDT', 'trend-following', '0.1.0', 'NONE', '["insufficient_data"]', '{"kind":"NONE"}', '2026-09-27T15:00:16.000Z')`)
      .run(cycleId.id)
    const decisionId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }

    db.prepare(`INSERT INTO order_intents (decision_id, symbol, alice_id, side, intent_json, created_at, updated_at)
                VALUES (?, 'BTC/USDT:USDT', 'bybit-readonly|BTC/USDT:USDT', 'BUY', '{}', '2026-09-27T15:00:17.000Z', '2026-09-27T15:00:17.000Z')`)
      .run(decisionId.id)
    const intentId = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }

    db.prepare(`INSERT INTO order_events (intent_id, event_type, detail_json, created_at)
                VALUES (?, 'STAGED', '{}', '2026-09-27T15:00:18.000Z')`).run(intentId.id)

    expect((db.prepare('SELECT COUNT(*) as n FROM cycles').get() as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) as n FROM decisions').get() as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) as n FROM order_intents').get() as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) as n FROM order_events').get() as { n: number }).n).toBe(1)
  })
})
