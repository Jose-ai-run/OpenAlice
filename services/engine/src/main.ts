/**
 * Engine service entry — Fase 1 skeleton.
 *
 * [PROPUESTA] Deterministic strategy/risk-mirror/execution engine, supervised
 * as an optional process the same way services/connector is (see ADR-0001).
 * This phase intentionally contains ZERO business logic: no strategies, no
 * sizing, no risk mirror, no UTA client, no scheduler, no database. It only
 * proves the package boots, binds loopback, and answers a health check —
 * the acceptance bar for Fase 1 in PROMPT_MASTER_CLAUDE_CODE.md §37 ("F1").
 *
 * Every other src/ subdirectory in this package is an empty placeholder for
 * the folder layout in PROMPT_MASTER_CLAUDE_CODE.md §7; later phases fill
 * them in one at a time.
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createHealthRoutes } from './http/routes-health.js'

// [PROPUESTA] Default port per PROMPT_MASTER_CLAUDE_CODE.md §9. Verified in
// Fase 0 / ADR-0001 not to collide with any port in scripts/guardian/shared.ts
// (web 47331, mcp 47332, uta 47333, connector 47334) or elsewhere in the repo.
const ENGINE_PORT = Number(process.env['ENGINE_HTTP_PORT'] ?? 47340)

export function createApp(startedAt: string): Hono {
  const app = new Hono()
  app.route('/', createHealthRoutes(startedAt))
  return app
}

export async function startEngineService(): Promise<void> {
  const startedAt = new Date().toISOString()
  console.log(`[engine] bootstrap @ ${startedAt}`)

  const app = createApp(startedAt)

  // Loopback-only, same convention as UTA (services/uta/src/main.ts) and
  // Connector (services/connector/src/main.ts) — this process is never
  // exposed directly to the public internet.
  const server = serve({
    fetch: app.fetch,
    port: ENGINE_PORT,
    hostname: '127.0.0.1',
  })
  console.log(`[engine] listening on http://127.0.0.1:${ENGINE_PORT}`)

  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    console.log(`[engine] ${signal} → shutdown`)
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

if (!(globalThis as { __OPENALICE_INTERNAL_ROLE_DISPATCH__?: boolean }).__OPENALICE_INTERNAL_ROLE_DISPATCH__) {
  startEngineService().catch((err) => {
    console.error('[engine] fatal:', err)
    process.exit(1)
  })
}
