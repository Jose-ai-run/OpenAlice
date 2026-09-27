/**
 * [PROPUESTA] UTA bearer-token auth middleware — Fase 4b, ADR-0003, M7.
 * Corrección 2026-09-27 (Fase 4b aprobada CON CORRECCIONES, item A.1).
 *
 * Compatibility mode (no `OPENALICE_UTA_TOKENS_FILE` configured at boot):
 * passes every request through unchanged — identical to pre-Fase-4b
 * behavior. The loud startup warning lives in `deployment-safety.ts`
 * (checked once at boot), not here, so this middleware stays silent
 * per-request in this mode.
 *
 * **The enforced/compatibility decision is made ONCE, at boot** — the
 * caller (`main.ts`) resolves `OPENALICE_UTA_TOKENS_FILE` a single time
 * and passes the result into `utaAuthMiddleware(tokensPath)` as a fixed
 * closure value. This middleware never re-reads the env var per request.
 * That matters: once UTA started in enforced mode, a *content* failure
 * on a later read (file deleted, truncated mid-write, corrupted) must
 * deny every request (401/503) — it must NEVER be interpreted as "the
 * operator un-configured auth" and fall back to compatibility mode. Only
 * an actual restart with the env var unset can do that.
 *
 * Enforced mode: every request needs `Authorization: Bearer <token>`.
 * No token or an unrecognized one → 401. Recognized but missing the
 * scope the route requires → 403. The tokens file itself failing to
 * load on a given request (missing/empty/corrupt/partial write) fails
 * closed — 503 + a logged alert, never "treat as no auth".
 */
import type { Context, MiddlewareHandler } from 'hono'
import { findToken, loadUtaTokens } from '../domain/trading/auth/tokens-file.js'
import type { UtaScope } from '../domain/trading/auth/types.js'

/**
 * Route → required-scope table, most-specific pattern first. Falls back
 * to `operator` for anything unmatched — a new route defaults to the
 * most privileged scope until someone deliberately loosens it, rather
 * than silently inheriting `read`.
 */
const SCOPE_RULES: ReadonlyArray<{ test: (method: string, path: string) => boolean; scope: UtaScope }> = [
  { test: (_m, path) => path.startsWith('/api/simulator'), scope: 'simulator' },
  { test: (m) => m === 'GET' || m === 'HEAD', scope: 'read' },
  // Pure market-data/account reads that happen to carry a JSON body
  // (structured Contract params) — not trading writes.
  {
    test: (_m, path) => /\/(quote|historical|contracts\/details|contract\/(option-contracts|option-chain|order-book|expand))$/.test(path),
    scope: 'read',
  },
  // Fase 4b corrección 2026-09-27 (item 2): /sync writes a new commit
  // reflecting fill/cancel status changes (UnifiedTradingAccount.sync()
  // -> `this.git.sync(updates, state)`, [VERIFICADO EN REPOSITORIO]) — a
  // real state write, not a plain read. 'stage' is the correct minimum,
  // not the 'operator' fallback, so an engine-scoped token (read+stage
  // only) can legitimately call it.
  { test: (_m, path) => /\/uta\/[^/]+\/sync$/.test(path), scope: 'stage' },
  { test: (_m, path) => /\/wallet\/stage-(place-order|modify-order|close-position|cancel-order)$/.test(path), scope: 'stage' },
  { test: (_m, path) => /\/wallet\/(commit|reject)$/.test(path), scope: 'stage' },
  { test: (_m, path) => /\/wallet\/(push|place-order|close-position|cancel-order)$/.test(path), scope: 'approve' },
]

export function requiredScope(method: string, path: string): UtaScope {
  const m = method.toUpperCase()
  for (const rule of SCOPE_RULES) {
    if (rule.test(m, path)) return rule.scope
  }
  return 'operator'
}

function extractBearer(c: Context): string | undefined {
  const header = c.req.header('authorization')
  if (!header) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : undefined
}

export interface UtaAuthInfo {
  label: string
  scopes: UtaScope[]
}

/**
 * @param tokensPath The path resolved from `OPENALICE_UTA_TOKENS_FILE`
 *   AT BOOT (or `undefined` if it was unset at boot) — see the module
 *   docstring for why this is a fixed argument, not re-read per request.
 */
export function utaAuthMiddleware(tokensPath: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!tokensPath) return next()  // compatibility mode — decided once, at boot; see deployment-safety.ts

    const loaded = await loadUtaTokens(tokensPath)
    if (!loaded.ok) {
      console.error(`[uta:auth] tokens file unreadable/invalid — denying ALL requests, not falling back to compatibility mode: ${loaded.reason}`)
      return c.json({ error: 'UTA auth misconfigured', detail: loaded.reason }, 503)
    }

    const candidate = extractBearer(c)
    if (!candidate) {
      return c.json({ error: 'Unauthorized', code: 'NO_TOKEN' }, 401)
    }
    const entry = findToken(loaded.tokens, candidate)
    if (!entry) {
      return c.json({ error: 'Unauthorized', code: 'INVALID_TOKEN' }, 401)
    }

    const scope = requiredScope(c.req.method, c.req.path)
    if (!entry.scopes.includes(scope)) {
      return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_SCOPE', requiredScope: scope }, 403)
    }

    c.set('utaAuth', { label: entry.label, scopes: entry.scopes } satisfies UtaAuthInfo)
    return next()
  }
}
