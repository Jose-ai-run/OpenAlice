/**
 * [PROPUESTA] Typed journal wrapper — Hito 1, item 2.
 *
 * Thin typed layer over the raw SQLite tables (`db/migrations/0001-init.ts`)
 * — every write goes through here so callers never hand-write SQL, and
 * every decision this Engine ever makes (including `NONE`, with its
 * `reasonCodes`) is durable before this function returns.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { BarInterval } from '@traderalice/uta-protocol'
import type { StrategyDecision } from '../strategies/types.js'

export type EngineMode = 'SIGNAL_ONLY' | 'PAPER'

export interface StartCycleInput {
  mode: EngineMode
  interval: BarInterval
  candleCloseAt: Date
  startedAt: Date
}

export interface RecordDecisionInput {
  cycleId: number
  symbol: string
  aliceId: string
  strategyId: string
  strategyVersion: string
  decision: StrategyDecision
  createdAt: Date
}

export interface RecordOrderIntentInput {
  decisionId: number
  symbol: string
  aliceId: string
  side: 'BUY' | 'SELL'
  status?: string
  intent: unknown
  now: Date
}

export interface RecordOrderEventInput {
  intentId: number
  eventType: string
  detail?: unknown
  now: Date
}

function reasonCodesOf(decision: StrategyDecision): string[] | undefined {
  return decision.kind === 'NONE' || decision.kind === 'EXIT' ? decision.reasonCodes : undefined
}

export class Journal {
  constructor(private readonly db: DatabaseSync) {}

  startCycle(input: StartCycleInput): number {
    this.db.prepare(`
      INSERT INTO cycles (mode, interval, candle_close_at, started_at, status)
      VALUES (?, ?, ?, ?, 'running')
    `).run(input.mode, input.interval, input.candleCloseAt.toISOString(), input.startedAt.toISOString())
    return this.lastInsertId()
  }

  finishCycle(cycleId: number, finishedAt: Date, status: 'completed' | 'failed', error?: string): void {
    this.db.prepare(`
      UPDATE cycles SET finished_at = ?, status = ?, error = ? WHERE cycle_id = ?
    `).run(finishedAt.toISOString(), status, error ?? null, cycleId)
  }

  recordDecision(input: RecordDecisionInput): number {
    const reasonCodes = reasonCodesOf(input.decision)
    this.db.prepare(`
      INSERT INTO decisions (cycle_id, symbol, alice_id, strategy_id, strategy_version, kind, reason_codes, decision_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.cycleId, input.symbol, input.aliceId, input.strategyId, input.strategyVersion,
      input.decision.kind, reasonCodes ? JSON.stringify(reasonCodes) : null,
      JSON.stringify(input.decision), input.createdAt.toISOString(),
    )
    return this.lastInsertId()
  }

  recordOrderIntent(input: RecordOrderIntentInput): number {
    this.db.prepare(`
      INSERT INTO order_intents (decision_id, symbol, alice_id, side, status, intent_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.decisionId, input.symbol, input.aliceId, input.side, input.status ?? 'PENDING',
      JSON.stringify(input.intent), input.now.toISOString(), input.now.toISOString(),
    )
    return this.lastInsertId()
  }

  recordOrderEvent(input: RecordOrderEventInput): number {
    this.db.prepare(`
      INSERT INTO order_events (intent_id, event_type, detail_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(input.intentId, input.eventType, input.detail !== undefined ? JSON.stringify(input.detail) : null, input.now.toISOString())
    return this.lastInsertId()
  }

  private lastInsertId(): number {
    return (this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id
  }
}
