/**
 * [PROPUESTA] Migration 0001 — Hito 1, item 2: cycles, decisions,
 * order_intents, order_events. `order_intents`/`order_events` exist from
 * this migration on even though nothing writes to them until PAPER mode
 * (item 5) — the schema is the full one Hito 1 asks for, not grown
 * incrementally per mode.
 */
import type { Migration } from '../migrate.js'
import { migration0002CounterfactualTrades } from './0002-counterfactual-trades.js'

export const migration0001Init: Migration = {
  id: 1,
  name: 'init',
  up(db) {
    db.exec(`
      CREATE TABLE cycles (
        cycle_id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        interval TEXT NOT NULL,
        candle_close_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
        error TEXT
      );
      CREATE INDEX idx_cycles_candle_close_at ON cycles(candle_close_at);

      CREATE TABLE decisions (
        decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_id INTEGER NOT NULL REFERENCES cycles(cycle_id),
        symbol TEXT NOT NULL,
        alice_id TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('NONE', 'ENTER', 'EXIT', 'ADJUST_STOP')),
        reason_codes TEXT,
        decision_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_decisions_cycle_id ON decisions(cycle_id);
      CREATE INDEX idx_decisions_symbol ON decisions(symbol);

      CREATE TABLE order_intents (
        intent_id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_id INTEGER NOT NULL REFERENCES decisions(decision_id),
        symbol TEXT NOT NULL,
        alice_id TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        status TEXT NOT NULL DEFAULT 'PENDING',
        intent_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_order_intents_decision_id ON order_intents(decision_id);

      CREATE TABLE order_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        intent_id INTEGER NOT NULL REFERENCES order_intents(intent_id),
        event_type TEXT NOT NULL,
        detail_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_order_events_intent_id ON order_events(intent_id);
    `)
  },
}

export const migrations = [migration0001Init, migration0002CounterfactualTrades]
