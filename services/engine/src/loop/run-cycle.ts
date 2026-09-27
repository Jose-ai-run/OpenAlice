/**
 * [PROPUESTA] Cycle orchestration — Hito 1, items 1+3+4.
 *
 * The one function both the real scheduler (production) and a replay
 * driver (the "3 real cycles" demo evidence, and later a Backtester)
 * call — same code path, same no-lookahead guarantee
 * (`buildStrategyContext`), so a replayed cycle is not a different code
 * path pretending to be the real one.
 *
 * SIGNAL_ONLY (Hito 1's first gate): fetches bars, decides, journals.
 * Never stages/commits/pushes anything — that only exists from PAPER
 * mode on (item 5, not part of this gate).
 */
import type { BarInterval } from '@traderalice/uta-protocol'
import type { Clock } from '../clock/clock.js'
import { systemClock } from '../clock/clock.js'
import type { MarketDataStore } from '../data/market-data-store.js'
import { buildStrategyContext } from '../strategies/context-builder.js'
import type { Strategy, StrategyDecision } from '../strategies/types.js'
import type { EngineConfig, UniverseEntry } from '../config/engine-config.js'
import type { Journal } from '../journal/journal.js'

export interface RunCycleOptions {
  config: EngineConfig
  marketDataStore: MarketDataStore
  strategy: Strategy
  journal: Journal
  /** The candle-close boundary this cycle evaluates — "now" for every
   *  no-lookahead check downstream. */
  closeAt: Date
  clock?: Clock
}

export interface CycleDecision {
  symbol: string
  aliceId: string
  decisionId: number
  decision: StrategyDecision
  barsUsed: number
}

export interface CycleResult {
  cycleId: number
  closeAt: Date
  decisions: CycleDecision[]
}

async function decideOne(
  entry: UniverseEntry, opts: RunCycleOptions, interval: BarInterval,
): Promise<{ decision: StrategyDecision; barsUsed: number }> {
  const dataset = await opts.marketDataStore.getBars({
    utaId: entry.utaId,
    symbol: entry.aliceId,
    contract: { aliceId: entry.aliceId },
    interval,
    limit: opts.config.historyBars,
    end: opts.closeAt,
  })
  const ctx = buildStrategyContext({
    bars: dataset.bars,
    interval,
    asOf: opts.closeAt,
    params: opts.config.strategy.params ?? {},
  })
  return { decision: opts.strategy.evaluate(ctx), barsUsed: ctx.bars.length }
}

export async function runCycle(opts: RunCycleOptions): Promise<CycleResult> {
  const clock = opts.clock ?? systemClock
  const startedAt = clock.now()
  const cycleId = opts.journal.startCycle({
    mode: opts.config.mode, interval: opts.config.interval,
    candleCloseAt: opts.closeAt, startedAt,
  })

  const decisions: CycleDecision[] = []
  try {
    for (const entry of opts.config.universe) {
      const { decision, barsUsed } = await decideOne(entry, opts, opts.config.interval)
      const decisionId = opts.journal.recordDecision({
        cycleId,
        symbol: entry.label,
        aliceId: entry.aliceId,
        strategyId: opts.strategy.id,
        strategyVersion: opts.strategy.version,
        decision,
        createdAt: clock.now(),
      })
      decisions.push({ symbol: entry.label, aliceId: entry.aliceId, decisionId, decision, barsUsed })
    }
    opts.journal.finishCycle(cycleId, clock.now(), 'completed')
  } catch (err) {
    opts.journal.finishCycle(cycleId, clock.now(), 'failed', err instanceof Error ? err.message : String(err))
    throw err
  }

  return { cycleId, closeAt: opts.closeAt, decisions }
}
