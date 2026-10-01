/**
 * [PROPUESTA] Engine lease fencing (A6) — ADR-0009, Enmienda 2.
 *
 * Mounted after `utaAuthMiddleware` for the wallet write routes — reads
 * `c.get('utaAuth')`, only set in enforced mode. In compatibility mode
 * (no tokens file) there is no scope to check, so this no-ops, same as
 * `engine-account-guard.ts`.
 *
 * Only a token whose scopes include `engine` is fenced here — a
 * `stage`-scoped human/operator token hitting the same wallet routes is
 * NOT subject to this check at all (the ADR is explicit: this protects
 * the Engine's own identity's authority, not every `stage`-scoped
 * caller).
 */
import type { Context, MiddlewareHandler } from 'hono'
import type { UtaAuthInfo } from './auth.js'
import { checkLeaseFencing } from '../domain/trading/risk/engine-lease.js'

function accountIdFromPath(path: string): string | undefined {
  const match = /\/uta\/([^/]+)/.exec(path)
  return match?.[1]
}

export function engineFencing(now: () => Date = () => new Date()): MiddlewareHandler {
  return async (c: Context, next) => {
    const auth = c.get('utaAuth') as UtaAuthInfo | undefined
    if (!auth) return next()  // compatibility mode — nothing to check
    if (!auth.scopes.includes('engine')) return next()  // not an Engine identity — not fenced here

    const header = c.req.header('x-engine-epoch')
    if (!header) {
      // Per the ADR: "Header ausente -> 401 (mismo código que 'no token')."
      return c.json({ error: 'Unauthorized', code: 'NO_ENGINE_EPOCH' }, 401)
    }
    const presentedEpoch = Number(header)
    if (!Number.isFinite(presentedEpoch)) {
      return c.json({ error: 'Unauthorized', code: 'NO_ENGINE_EPOCH', detail: 'X-Engine-Epoch is not a number' }, 401)
    }

    const accountId = accountIdFromPath(c.req.path)
    if (!accountId) return next()

    const result = await checkLeaseFencing(accountId, presentedEpoch, now())
    if (!result.ok) {
      return c.json({ error: 'Conflict', code: result.code, detail: result.message, currentEpoch: result.currentEpoch }, 409)
    }
    return next()
  }
}
