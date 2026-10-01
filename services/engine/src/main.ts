/**
 * Engine service entry.
 *
 * Fase 1 proved the package boots, binds loopback, and answers a health
 * check (PROMPT_MASTER_CLAUDE_CODE.md §37 "F1") with zero business logic.
 * Hito 1 Parte 2, item 3d adds the one piece of real wiring this process
 * does today: a read-only status page over whatever a replay driver
 * (signal-only-replay.ts / paper-canary.ts) already wrote to its journal —
 * still no live scheduler, no strategies run by this process itself (see
 * routes-status.ts's own docstring on why `origin` says so explicitly).
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createHealthRoutes } from './http/routes-health.js'
import { createStatusRoutes, type StatusRouteDeps } from './http/routes-status.js'
import { loadEngineConfig } from './config/engine-config.js'
import { openDatabase } from './db/database.js'
import { runMigrations } from './db/migrate.js'
import { migrations } from './db/migrations/0001-init.js'
import { Journal } from './journal/journal.js'

// [PROPUESTA] Default port per PROMPT_MASTER_CLAUDE_CODE.md §9. Verified in
// Fase 0 / ADR-0001 not to collide with any port in scripts/guardian/shared.ts
// (web 47331, mcp 47332, uta 47333, connector 47334) or elsewhere in the repo.
const ENGINE_PORT = Number(process.env['ENGINE_HTTP_PORT'] ?? 47340)

export function createApp(startedAt: string, statusDeps?: StatusRouteDeps): Hono {
  const app = new Hono()
  app.route('/', createHealthRoutes(startedAt))
  if (statusDeps) app.route('/', createStatusRoutes(statusDeps))
  return app
}

/**
 * Loads the status page's dependencies from `ENGINE_CONFIG_PATH`/`ENGINE_DB_PATH`
 * (falling back to the canary's own config/db — the only ones that exist
 * today). Returns `undefined` (status route omitted, health-only, exactly
 * Fase 1's behavior) when neither resolves — never throws at boot over a
 * missing demo artifact.
 */
function loadStatusDepsIfAvailable(): StatusRouteDeps | undefined {
  const configPath = process.env['ENGINE_CONFIG_PATH'] ?? resolve(import.meta.dirname, '../config/engine-config.canary.json')
  const dbPath = process.env['ENGINE_DB_PATH'] ?? resolve(import.meta.dirname, '../data/paper-canary.db')
  if (!existsSync(configPath) || !existsSync(dbPath)) {
    console.log(`[engine] status page disabled — config or db not found (${configPath} / ${dbPath})`)
    return undefined
  }
  const config = loadEngineConfig(JSON.parse(readFileSync(configPath, 'utf-8')))
  const db = openDatabase(dbPath)
  runMigrations(db, migrations)
  const journal = new Journal(db)
  const utaBaseUrl = process.env['OPENALICE_UTA_URL'] ?? 'http://127.0.0.1:47333'
  return { config, journal, utaBaseUrl }
}

export async function startEngineService(): Promise<void> {
  const startedAt = new Date().toISOString()
  console.log(`[engine] bootstrap @ ${startedAt}`)

  const statusDeps = loadStatusDepsIfAvailable()
  const app = createApp(startedAt, statusDeps)

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
