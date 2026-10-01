/**
 * [PROPUESTA] Engine-side lease client — ADR-0009 (A6, F7). Calls UTA's
 * real `POST /api/trading/risk/engine-lease` (services/uta/src/http/
 * routes-risk.ts) and implements Enmienda 3: a lease transfer to a NEW
 * instanceId must reconcile (reject any inherited pending commit) before
 * this instance stages anything.
 *
 * Not wired into a live scheduler yet — services/engine/src/main.ts has no
 * periodic loop (see its own docstring). This is the real, tested function
 * a future scheduler/ExecutionManager calls; paper-canary.ts does not use
 * it today (the canary talks to UTA directly, without an engine-scoped
 * lease — documented honestly in AUDIT.md §19 rather than wired in just to
 * look complete).
 */

export interface EngineLeaseClientOptions {
  utaBaseUrl: string
  accountId: string
  instanceId: string
  fetchImpl?: typeof fetch
}

export interface AcquiredLease {
  epoch: number
  expiresAt: string
}

async function utaFetch(baseUrl: string, path: string, fetchImpl: typeof fetch, init?: RequestInit) {
  const res = await fetchImpl(`${baseUrl}${path}`, { headers: { 'content-type': 'application/json' }, ...init })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, body }
}

export class EngineLeaseClient {
  constructor(private readonly options: EngineLeaseClientOptions) {}

  /**
   * Acquire or renew the lease. Throws `LeaseHeldError` on a real 409
   * conflict (someone else holds it) — callers decide whether to wait or
   * give up, per the ADR ("el llamante puede así decidir con información").
   */
  async acquireOrRenew(ttlSec: number): Promise<AcquiredLease> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const res = await utaFetch(this.options.utaBaseUrl, '/api/trading/risk/engine-lease', fetchImpl, {
      method: 'POST',
      body: JSON.stringify({ accountId: this.options.accountId, instanceId: this.options.instanceId, ttlSec }),
    })
    if (res.status === 409) {
      const holder = (res.body as { holder?: { instanceId: string; expiresAt: string } }).holder
      throw new LeaseHeldError(holder)
    }
    if (!res.ok) throw new Error(`engine-lease acquire failed: ${res.status} ${JSON.stringify(res.body)}`)
    return res.body as AcquiredLease
  }

  /** Enmienda 4 — explicit release on an ordered shutdown. */
  async release(): Promise<void> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    await utaFetch(this.options.utaBaseUrl, '/api/trading/risk/engine-lease', fetchImpl, {
      method: 'POST',
      body: JSON.stringify({ accountId: this.options.accountId, instanceId: this.options.instanceId, ttlSec: 1, release: true }),
    })
  }

  /**
   * Enmienda 3 — before this instance's FIRST write after acquiring a
   * (possibly transferred) lease: if the account has a pending commit, it
   * is unambiguously the previous instance's (TradingGit allows at most
   * one at a time) — reject it, never adopt/push it, and say so in the
   * reject reason so the independent audit (ADR-0010) doesn't confuse it
   * with a human policy rejection.
   */
  async reconcileBeforeFirstWrite(): Promise<{ reconciled: boolean; rejectedPendingHash?: string }> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const status = await utaFetch(this.options.utaBaseUrl, `/api/trading/uta/${this.options.accountId}/wallet/status`, fetchImpl)
    const pendingHash = (status.body as { pendingHash?: string | null }).pendingHash
    if (!pendingHash) return { reconciled: true }

    const reject = await utaFetch(this.options.utaBaseUrl, `/api/trading/uta/${this.options.accountId}/wallet/reject`, fetchImpl, {
      method: 'POST',
      body: JSON.stringify({
        expectedPendingHash: pendingHash,
        reason: `lease transfer reconciliation (ADR-0009 Enmienda 3) — inherited pending commit from a previous Engine instance, rejected, not adopted`,
      }),
    })
    if (!reject.ok) throw new Error(`reconciliation reject failed: ${reject.status} ${JSON.stringify(reject.body)}`)
    return { reconciled: true, rejectedPendingHash: pendingHash }
  }
}

export class LeaseHeldError extends Error {
  constructor(public readonly holder: { instanceId: string; expiresAt: string } | undefined) {
    super(`engine lease is held by ${holder?.instanceId ?? 'unknown'} until ${holder?.expiresAt ?? 'unknown'}`)
  }
}
