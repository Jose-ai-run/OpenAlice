/**
 * [PROPUESTA] Typed UTA client for the Engine (PROMPT_MASTER_CLAUDE_CODE.md
 * §7: "src/uta/ # cliente UTA tipado (usa UTAClient + token)").
 *
 * Fase 2 scope: read-only historical bars only (POST /uta/:id/historical).
 *
 * Fase 4b (M7/M8, ADR-0003): sends `Authorization: Bearer <token>` when
 * `token` is configured. Per ADR-0003's scope table, the Engine's own
 * token is expected to carry `read` (this route resolves to `read`, not
 * `engine` — see services/uta/src/http/auth.ts's SCOPE_RULES) plus
 * `engine` as an identity label; the Engine never carries `approve` or
 * `operator` (it never executes directly — ADR-0006, PROMPT_MASTER §12).
 */

import type { Bar, BarParams } from '@traderalice/uta-protocol'

export interface EngineUtaClientOptions {
  /** UTA base URL, e.g. http://127.0.0.1:47333 — no trailing slash. */
  baseUrl: string
  /** Injectable for hermetic tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Bearer token — omit when UTA runs in compatibility mode. */
  token?: string
}

export interface HistoricalBarsRequest {
  utaId: string
  /** Same shape UTA's route accepts: a Contract or a `{ aliceId }` stub. */
  contract: { aliceId: string } | Record<string, unknown>
  params: BarParams
}

interface HistoricalBarsWireResponse {
  bars: Array<Omit<Bar, 'timestamp'> & { timestamp: string }>
}

export class EngineUtaClient {
  constructor(private readonly options: EngineUtaClientOptions) {}

  async getHistoricalBars(req: HistoricalBarsRequest): Promise<Bar[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const url = `${this.options.baseUrl}/api/trading/uta/${encodeURIComponent(req.utaId)}/historical`
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.options.token) headers['authorization'] = `Bearer ${this.options.token}`
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contract: req.contract, params: req.params }),
    })
    if (!res.ok) {
      throw new Error(`UTA historical fetch failed: ${res.status} ${await res.text()}`)
    }
    const body = await res.json() as HistoricalBarsWireResponse
    // Dates arrive as ISO strings over JSON; revive them — the only Date
    // field on Bar (mirrors the revival routes-trading.ts does on the way in).
    return body.bars.map((b) => ({ ...b, timestamp: new Date(b.timestamp) }))
  }
}
