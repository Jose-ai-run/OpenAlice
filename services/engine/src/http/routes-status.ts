/**
 * [PROPUESTA] Read-only status route — Hito 1 Parte 2, item 3d
 * (PROMPT_MASTER_CLAUDE_CODE.md §20's `/engine/status`, narrowed to what
 * actually exists: there is no live scheduler wired into main.ts yet — see
 * main.ts's own "Fase 1 skeleton" docstring — so every decision in the
 * journal right now necessarily comes from a replay driver
 * (signal-only-replay.ts / paper-canary.ts), never a live run. Rather than
 * fabricate a provenance column implying live-tracking exists, this route
 * says so plainly in `origin`.
 */
import { Hono } from 'hono'
import type { EngineConfig } from '../config/engine-config.js'
import type { Journal } from '../journal/journal.js'

export interface StatusRouteDeps {
  config: EngineConfig
  journal: Journal
  utaBaseUrl: string
  now?: () => Date
}

async function utaGet(baseUrl: string, path: string): Promise<unknown> {
  try {
    const res = await fetch(`${baseUrl}${path}`)
    return await res.json().catch(() => ({ error: 'invalid JSON response' }))
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function buildStatus(deps: StatusRouteDeps) {
  const now = (deps.now ?? (() => new Date()))()
  const paperAccountId = deps.config.paperAccountId

  const instrumentMapping = deps.config.universe.map((entry) => ({
    label: entry.label,
    aliceId: entry.aliceId,
    executionAliceId: paperAccountId ? `${paperAccountId}|${entry.aliceId.slice(entry.aliceId.indexOf('|') + 1)}` : null,
  }))

  const recentDecisions = deps.journal.recentDecisions(20).map((d) => ({
    ...d,
    ageSeconds: Math.round((now.getTime() - new Date(d.createdAt).getTime()) / 1000),
    origin: 'canary (sin scheduler en vivo wireado todavía — ver services/engine/src/main.ts)' as const,
  }))

  const killSwitch = paperAccountId ? await utaGet(deps.utaBaseUrl, `/api/risk/uta/${paperAccountId}/kill-switch`) : null
  const walletStatus = paperAccountId ? await utaGet(deps.utaBaseUrl, `/api/trading/uta/${paperAccountId}/wallet/status`) : null

  return {
    now: now.toISOString(),
    mode: deps.config.mode,
    paperAccountId: paperAccountId ?? null,
    instrumentMapping,
    dataStalenessSeconds: recentDecisions[0]?.ageSeconds ?? null,
    killSwitch,
    walletStatus,
    recentDecisions,
  }
}

function renderHtml(status: Awaited<ReturnType<typeof buildStatus>>): string {
  const rows = status.recentDecisions.map((d) => `
    <tr>
      <td>${d.createdAt}</td>
      <td>${d.symbol}</td>
      <td>${d.kind}</td>
      <td>${d.ageSeconds}s</td>
      <td>${d.origin}</td>
    </tr>`).join('')
  const mapping = status.instrumentMapping.map((m) => `<tr><td>${m.label}</td><td>${m.aliceId}</td><td>${m.executionAliceId ?? 'NO ENCONTRADO — sin paperAccountId'}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Engine status</title>
<style>body{font-family:monospace;margin:2rem;background:#111;color:#ddd}
table{border-collapse:collapse;width:100%;margin-bottom:2rem}
td,th{border:1px solid #444;padding:4px 8px;text-align:left}
h1,h2{color:#fff}</style></head><body>
<h1>Engine status — ${status.now}</h1>
<p>modo=${status.mode} paperAccountId=${status.paperAccountId ?? 'NO ENCONTRADO'} killSwitch=${JSON.stringify(status.killSwitch)}</p>
<p>staleness de datos: ${status.dataStalenessSeconds ?? 'NO ENCONTRADO'}s</p>
<h2>Mapeo de instrumentos</h2>
<table><tr><th>label</th><th>aliceId (dato)</th><th>aliceId (ejecución)</th></tr>${mapping}</table>
<h2>Decisiones recientes</h2>
<table><tr><th>cuando</th><th>símbolo</th><th>kind</th><th>antigüedad</th><th>origen</th></tr>${rows}</table>
<h2>Estado de la billetera (paperAccountId)</h2>
<pre>${JSON.stringify(status.walletStatus, null, 2)}</pre>
</body></html>`
}

export function createStatusRoutes(deps: StatusRouteDeps): Hono {
  const app = new Hono()

  app.get('/engine/status', async (c) => c.json(await buildStatus(deps)))

  app.get('/', async (c) => c.html(renderHtml(await buildStatus(deps))))

  return app
}
