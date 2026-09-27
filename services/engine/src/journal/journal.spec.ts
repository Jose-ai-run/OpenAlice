import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db/database.js'
import { runMigrations } from '../db/migrate.js'
import { migrations } from '../db/migrations/0001-init.js'
import { Journal } from './journal.js'
import type { StrategyDecision } from '../strategies/types.js'

function makeJournal(): Journal {
  const db = openDatabase(':memory:')
  runMigrations(db, migrations)
  return new Journal(db)
}

describe('Journal', () => {
  it('starts and finishes a cycle', () => {
    const journal = makeJournal()
    const cycleId = journal.startCycle({
      mode: 'SIGNAL_ONLY', interval: '1h',
      candleCloseAt: new Date('2026-09-27T15:00:00.000Z'),
      startedAt: new Date('2026-09-27T15:00:15.000Z'),
    })
    expect(cycleId).toBeGreaterThan(0)
    expect(() => journal.finishCycle(cycleId, new Date('2026-09-27T15:00:20.000Z'), 'completed')).not.toThrow()
  })

  it('records a NONE decision with its reasonCodes, round-trippable', () => {
    const journal = makeJournal()
    const cycleId = journal.startCycle({
      mode: 'SIGNAL_ONLY', interval: '1h',
      candleCloseAt: new Date('2026-09-27T15:00:00.000Z'), startedAt: new Date(),
    })
    const decision: StrategyDecision = { kind: 'NONE', reasonCodes: ['insufficient_data'] }
    const decisionId = journal.recordDecision({
      cycleId, symbol: 'BTC/USDT:USDT', aliceId: 'bybit-readonly|BTC/USDT:USDT',
      strategyId: 'trend-following', strategyVersion: '0.1.0', decision, createdAt: new Date(),
    })
    expect(decisionId).toBeGreaterThan(0)
  })

  it('records an ENTER decision (with its mandatory stop) as valid JSON', () => {
    const journal = makeJournal()
    const cycleId = journal.startCycle({
      mode: 'SIGNAL_ONLY', interval: '1h',
      candleCloseAt: new Date('2026-09-27T15:00:00.000Z'), startedAt: new Date(),
    })
    const decision: StrategyDecision = {
      kind: 'ENTER', side: 'long', entry: 84_500, stop: 83_000, score: 0.7, reasonCodes: ['fast_cross_above_slow'],
    }
    const decisionId = journal.recordDecision({
      cycleId, symbol: 'BTC/USDT:USDT', aliceId: 'bybit-readonly|BTC/USDT:USDT',
      strategyId: 'trend-following', strategyVersion: '0.1.0', decision, createdAt: new Date(),
    })
    expect(decisionId).toBeGreaterThan(0)
  })

  it('records an order intent linked to a decision, and an order event linked to that intent', () => {
    const journal = makeJournal()
    const cycleId = journal.startCycle({
      mode: 'PAPER', interval: '1h',
      candleCloseAt: new Date('2026-09-27T15:00:00.000Z'), startedAt: new Date(),
    })
    const decisionId = journal.recordDecision({
      cycleId, symbol: 'BTC/USDT:USDT', aliceId: 'bybit-readonly|BTC/USDT:USDT',
      strategyId: 'trend-following', strategyVersion: '0.1.0',
      decision: { kind: 'ENTER', side: 'long', entry: 84_500, stop: 83_000, score: 0.7, reasonCodes: [] },
      createdAt: new Date(),
    })
    const intentId = journal.recordOrderIntent({
      decisionId, symbol: 'BTC/USDT:USDT', aliceId: 'engine-paper|BTC/USDT:USDT',
      side: 'BUY', intent: { qty: '0.01' }, now: new Date(),
    })
    expect(intentId).toBeGreaterThan(0)
    expect(() => journal.recordOrderEvent({ intentId, eventType: 'STAGED', now: new Date() })).not.toThrow()
  })
})
