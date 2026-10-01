/**
 * [PROPUESTA] PriceFeeder — Hito 1 Parte 2, item 3b (PROMPT_MASTER_CLAUDE_CODE.md
 * §23: "PriceFeeder del Engine que toma quotes reales del venue y llama a
 * POST /api/simulator/uta/:id/mark-price"). No new UTA surface — this is a
 * thin client over the simulator route that already exists
 * (services/uta/src/http/routes-simulator.ts), mirroring EngineUtaClient's
 * shape (uta/uta-client.ts).
 */
export interface PriceFeederOptions {
  /** UTA base URL, e.g. http://127.0.0.1:47333 — no trailing slash. */
  utaBaseUrl: string
  /** Injectable for hermetic tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

export interface SetMarkPriceResult {
  /** Order ids the mark-price move auto-matched (pending LMT/STP orders). */
  filled: string[]
}

export class PriceFeeder {
  constructor(private readonly options: PriceFeederOptions) {}

  async setMarkPrice(paperAccountId: string, nativeKey: string, price: string): Promise<SetMarkPriceResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const url = `${this.options.utaBaseUrl}/api/simulator/uta/${encodeURIComponent(paperAccountId)}/mark-price`
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nativeKey, price }),
    })
    if (!res.ok) {
      throw new Error(`PriceFeeder: setMarkPrice(${paperAccountId}, ${nativeKey}) failed: ${res.status} ${await res.text()}`)
    }
    return await res.json() as SetMarkPriceResult
  }
}

/**
 * The execution-side nativeKey for a universe entry is the same instrument
 * string already verified against the data source, reused verbatim on the
 * paper account — see UnifiedTradingAccount.contractFromAliceId (parses
 * "<utaId>|<nativeKey>" and calls broker.resolveNativeKey(nativeKey); for
 * MockBroker, resolveNativeKey sets both symbol and localSymbol to that same
 * string, so getNativeKey() returns it unchanged). No separate contract
 * search against the paper account is needed or invented.
 */
export function nativeKeyOf(aliceId: string): string {
  const sep = aliceId.indexOf('|')
  if (sep < 0) throw new Error(`nativeKeyOf: invalid aliceId "${aliceId}" (expected "<utaId>|<nativeKey>")`)
  return aliceId.slice(sep + 1)
}

/** The paper/execution account's own aliceId for the same instrument. */
export function paperAliceId(paperAccountId: string, universeAliceId: string): string {
  return `${paperAccountId}|${nativeKeyOf(universeAliceId)}`
}
