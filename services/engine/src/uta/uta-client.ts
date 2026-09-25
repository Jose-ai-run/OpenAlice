/**
 * [PROPUESTA] Typed UTA client for the Engine (PROMPT_MASTER_CLAUDE_CODE.md
 * §7: "src/uta/ # cliente UTA tipado (usa UTAClient + token)").
 *
 * Fase 2 scope: read-only historical bars only (POST /uta/:id/historical).
 * No auth token is sent yet — UTA has none to check (Fase 0 finding 3;
 * ADR-0003 designs the token/scopes contract but defers implementation).
 * When M7/M8 land, this client gains an `Authorization: Bearer` header
 * without changing its public shape.
 */

import type { Bar, BarParams } from '@traderalice/uta-protocol'

export interface EngineUtaClientOptions {
  /** UTA base URL, e.g. http://127.0.0.1:47333 — no trailing slash. */
  baseUrl: string
  /** Injectable for hermetic tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
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
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
