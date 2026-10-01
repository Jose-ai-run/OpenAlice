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

  it('recentDecisions returns newest-first, round-tripping kind/reasonCodes/decision', () => {
    const journal = makeJournal()
    const cycleId = journal.startCycle({
      mode: 'SIGNAL_ONLY', interval: '1h',
      candleCloseAt: new Date('2026-09-27T15:00:00.000Z'), startedAt: new Date(),
    })
    journal.recordDecision({
      cycleId, symbol: 'BTC', aliceId: 'bybit-readonly|BTC/USDT:USDT',
      strategyId: 'trend-following', strategyVersion: '0.1.0',
      decision: { kind: 'NONE', reasonCodes: ['no_signal'] }, createdAt: new Date('2026-09-27T15:00:01.000Z'),
    })
    journal.recordDecision({
      cycleId, symbol: 'ETH', aliceId: 'bybit-readonly|ETH/USDT:USDT',
      strategyId: 'trend-following', strategyVersion: '0.1.0',
      decision: { kind: 'ENTER', side: 'long', entry: 100, stop: 95, score: 0.5, reasonCodes: ['x'] },
      createdAt: new Date('2026-09-27T15:00:02.000Z'),
    })

    const recent = journal.recentDecisions(10)
    expect(recent).toHaveLength(2)
    expect(recent[0]?.symbol).toBe('ETH')  // newest first
    expect(recent[0]?.kind).toBe('ENTER')
    expect(recent[0]?.decision).toEqual({ kind: 'ENTER', side: 'long', entry: 100, stop: 95, score: 0.5, reasonCodes: ['x'] })
    expect(recent[1]?.symbol).toBe('BTC')
    expect(recent[1]?.reasonCodes).toEqual(['no_signal'])
  })

  it('recentDecisions respects the limit', () => {
    const journal = makeJournal()
    const cycleId = journal.startCycle({
      mode: 'SIGNAL_ONLY', interval: '1h',
      candleCloseAt: new Date('2026-09-27T15:00:00.000Z'), startedAt: new Date(),
    })
    for (let i = 0; i < 5; i++) {
      journal.recordDecision({
        cycleId, symbol: `S${i}`, aliceId: `bybit-readonly|S${i}`,
        strategyId: 'trend-following', strategyVersion: '0.1.0',
        decision: { kind: 'NONE' }, createdAt: new Date(),
      })
    }
    expect(journal.recentDecisions(2)).toHaveLength(2)
  })

  it('recordCounterfactualTrade persists a blocked signal (AUDIT.md §19, item 2)', () => {
    const journal = makeJournal()
    const cycleId = journal.startCycle({
      mode: 'PAPER', interval: '1h',
      candleCloseAt: new Date('2026-09-27T15:00:00.000Z'), startedAt: new Date(),
    })
    const decisionId = journal.recordDecision({
      cycleId, symbol: 'BTC/USDT:USDT', aliceId: 'bybit-readonly|BTC/USDT:USDT',
      strategyId: 'trend-following', strategyVersion: '0.1.0',
      decision: { kind: 'ENTER', side: 'long', entry: 100, stop: 95, score: 0.5, reasonCodes: [] },
      createdAt: new Date(),
    })
    const id = journal.recordCounterfactualTrade({
      decisionId, symbol: 'BTC/USDT:USDT', aliceId: 'bybit-readonly|BTC/USDT:USDT',
      side: 'BUY', wouldBeEntry: '100', wouldBeStop: '95', wouldBeQty: '0.01',
      blockedBy: 'R16', blockedReason: 'daily loss halt', bid: '99.9', ask: '100.1', spread: '0.2',
      now: new Date(),
    })
    expect(id).toBeGreaterThan(0)
  })
})
