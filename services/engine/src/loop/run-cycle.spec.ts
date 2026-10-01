import { describe, expect, it, vi } from 'vitest'
import type { Bar } from '@traderalice/uta-protocol'
import { MarketDataStore } from '../data/market-data-store.js'
import type { EngineUtaClient } from '../uta/uta-client.js'
import { openDatabase } from '../db/database.js'
import { runMigrations } from '../db/migrate.js'
import { migrations } from '../db/migrations/0001-init.js'
import { Journal } from '../journal/journal.js'
import type { EngineConfig } from '../config/engine-config.js'
import type { Strategy, StrategyDecision } from '../strategies/types.js'
import { runCycle } from './run-cycle.js'

function bar(timestamp: string, close: string): Bar {
  return { timestamp: new Date(timestamp), open: close, high: close, low: close, close, volume: '1' }
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    mode: 'SIGNAL_ONLY', interval: '1h', historyBars: 10,
    strategy: { id: 'fake', params: {} },
    universe: [{ label: 'BTC', utaId: 'bybit-readonly', aliceId: 'bybit-readonly|BTC/USDT:USDT' }],
    ...overrides,
  }
}

function makeJournal(): Journal {
  const db = openDatabase(':memory:')
  runMigrations(db, migrations)
  return new Journal(db)
}

describe('runCycle', () => {
  it('fetches bars up to closeAt, evaluates the strategy, and journals a NONE decision', async () => {
    const bars = [bar('2026-09-27T13:00:00.000Z', '100'), bar('2026-09-27T14:00:00.000Z', '101')]
    const client = { getHistoricalBars: vi.fn(async () => bars) } as unknown as EngineUtaClient
    const store = new MarketDataStore({ client })
    const journal = makeJournal()
    const alwaysNone: Strategy = {
      id: 'fake', version: '1.0.0', paramsSchema: {} as never,
      warmup: () => [], evaluate: (): StrategyDecision => ({ kind: 'NONE', reasonCodes: ['test'] }),
    }

    const result = await runCycle({
      config: makeConfig(), marketDataStore: store, strategy: alwaysNone, journal,
      closeAt: new Date('2026-09-27T15:00:00.000Z'),
    })

    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0]?.decision.kind).toBe('NONE')
    expect(client.getHistoricalBars).toHaveBeenCalledWith(expect.objectContaining({
      utaId: 'bybit-readonly',
      params: expect.objectContaining({ end: new Date('2026-09-27T15:00:00.000Z') }),
    }))
  })

  it('journals one decision per universe entry', async () => {
    const client = { getHistoricalBars: vi.fn(async () => [bar('2026-09-27T14:00:00.000Z', '100')]) } as unknown as EngineUtaClient
    const store = new MarketDataStore({ client })
    const journal = makeJournal()
    const alwaysNone: Strategy = {
      id: 'fake', version: '1.0.0', paramsSchema: {} as never,
      warmup: () => [], evaluate: (): StrategyDecision => ({ kind: 'NONE' }),
    }
    const config = makeConfig({
      universe: [
        { label: 'BTC', utaId: 'bybit-readonly', aliceId: 'bybit-readonly|BTC/USDT:USDT' },
        { label: 'ETH', utaId: 'bybit-readonly', aliceId: 'bybit-readonly|ETH/USDT:USDT' },
      ],
    })

    const result = await runCycle({
      config, marketDataStore: store, strategy: alwaysNone, journal, closeAt: new Date('2026-09-27T15:00:00.000Z'),
    })

    expect(result.decisions.map((d) => d.symbol)).toEqual(['BTC', 'ETH'])
    expect(client.getHistoricalBars).toHaveBeenCalledTimes(2)
  })

  it('marks the cycle failed and rethrows when a decision fails', async () => {
    const client = { getHistoricalBars: vi.fn(async () => { throw new Error('broker down') }) } as unknown as EngineUtaClient
    const store = new MarketDataStore({ client })
    const journal = makeJournal()
    const boom: Strategy = {
      id: 'fake', version: '1.0.0', paramsSchema: {} as never,
      warmup: () => [], evaluate: (): StrategyDecision => ({ kind: 'NONE' }),
    }

    await expect(runCycle({
      config: makeConfig(), marketDataStore: store, strategy: boom, journal, closeAt: new Date('2026-09-27T15:00:00.000Z'),
    })).rejects.toThrow('broker down')
  })

  it('never includes a bar after closeAt in what the strategy sees (no-lookahead, end to end)', async () => {
    // Bar.timestamp is OPEN time — a 1h bar opened at 14:00 closes at
    // 15:00, not 14:00. With closeAt=15:00, the 13:00 and 14:00 bars are
    // both closed by then; the 15:00 bar (closes at 16:00) is still open
    // and must be excluded even though its own timestamp <= closeAt.
    const bars = [
      bar('2026-09-27T13:00:00.000Z', '100'),
      bar('2026-09-27T14:00:00.000Z', '101'),
      bar('2026-09-27T15:00:00.000Z', '999'),  // still open as of closeAt=15:00 — must be excluded
    ]
    const client = { getHistoricalBars: vi.fn(async () => bars) } as unknown as EngineUtaClient
    const store = new MarketDataStore({ client })
    const journal = makeJournal()
    let seenCloses: string[] = []
    const spyStrategy: Strategy = {
      id: 'fake', version: '1.0.0', paramsSchema: {} as never,
      warmup: () => [],
      evaluate: (ctx): StrategyDecision => {
        seenCloses = ctx.bars.map((b) => b.close)
        return { kind: 'NONE' }
      },
    }

    await runCycle({
      config: makeConfig(), marketDataStore: store, strategy: spyStrategy, journal,
      closeAt: new Date('2026-09-27T15:00:00.000Z'),
    })

    expect(seenCloses).toEqual(['100', '101'])
  })

  it('threads getPosition into the strategy context (Hito 1 Parte 2) — omitted keeps position undefined', async () => {
    const client = { getHistoricalBars: vi.fn(async () => [bar('2026-09-27T14:00:00.000Z', '100')]) } as unknown as EngineUtaClient
    const store = new MarketDataStore({ client })
    const journal = makeJournal()
    let seenPosition: unknown
    const spyStrategy: Strategy = {
      id: 'fake', version: '1.0.0', paramsSchema: {} as never,
      warmup: () => [],
      evaluate: (ctx): StrategyDecision => { seenPosition = ctx.position; return { kind: 'NONE' } },
    }

    await runCycle({
      config: makeConfig(), marketDataStore: store, strategy: spyStrategy, journal,
      closeAt: new Date('2026-09-27T15:00:00.000Z'),
    })
    expect(seenPosition).toBeUndefined()

    const openPosition = { side: 'long' as const, entry: 100, stop: 95 }
    await runCycle({
      config: makeConfig(), marketDataStore: store, strategy: spyStrategy, journal,
      closeAt: new Date('2026-09-27T15:00:00.000Z'),
      getPosition: () => openPosition,
    })
    expect(seenPosition).toEqual(openPosition)
  })
})
