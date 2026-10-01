/**
 * [PROPUESTA] Migration 0002 — AUDIT.md §19, item 2 (A2). Schema only —
 * the detection pipeline that would populate this table (a RiskEngine
 * mirror inside the Engine, PROMPT_MASTER_CLAUDE_CODE.md's "espejo de
 * riesgo", not built yet) is out of scope for this change; the report
 * over this table belongs to F6 per the explicit instruction this
 * migration was requested under. Every strategy decision that would have
 * traded but was blocked (by a risk-mirror check, a mode cap, or an
 * explicit kill switch) is a candidate row — `blocked_by`/`blocked_reason`
 * record why, `decision_id` links back to the real journaled decision so
 * the F6 report can join without ambiguity.
 */
import type { Migration } from '../migrate.js'

export const migration0002CounterfactualTrades: Migration = {
  id: 2,
  name: 'counterfactual_trades',
  up(db) {
    db.exec(`
      CREATE TABLE counterfactual_trades (
        counterfactual_id INTEGER PRIMARY KEY AUTOINCREMENT,
        decision_id INTEGER NOT NULL REFERENCES decisions(decision_id),
        symbol TEXT NOT NULL,
        alice_id TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        would_be_entry TEXT NOT NULL,
        would_be_stop TEXT NOT NULL,
        would_be_qty TEXT,
        blocked_by TEXT NOT NULL,
        blocked_reason TEXT NOT NULL,
        bid TEXT,
        ask TEXT,
        spread TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_counterfactual_trades_decision_id ON counterfactual_trades(decision_id);
      CREATE INDEX idx_counterfactual_trades_symbol ON counterfactual_trades(symbol);
    `)
  },
}
