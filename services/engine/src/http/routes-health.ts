/**
 * Engine health route — Fase 1 skeleton only.
 *
 * `GET /engine/health` is the one endpoint this phase implements for real.
 * `/engine/ready`, `/engine/status`, `/engine/metrics`, `/engine/decisions/:id`
 * and `/engine/why` are PROPUESTA (PROMPT_MASTER_CLAUDE_CODE.md §20) and are
 * deliberately not built here — they need a Scheduler, DecisionJournal and
 * RiskEngine mirror that do not exist yet.
 */

import { Hono } from 'hono'

export function createHealthRoutes(startedAt: string): Hono {
  const app = new Hono()

  app.get('/engine/health', (c) => c.json({
    ok: true,
    startedAt,
  }))

  return app
}
