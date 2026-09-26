/**
 * [PROPUESTA] UTA bearer-token auth middleware — Fase 4b, ADR-0003, M7.
 *
 * Compatibility mode (no `OPENALICE_UTA_TOKENS_FILE` configured): passes
 * every request through unchanged — identical to pre-Fase-4b behavior.
 * The loud startup warning lives in `deployment-safety.ts` (checked once
 * at boot), not here, so this middleware stays silent per-request.
 *
 * Enforced mode: every request needs `Authorization: Bearer <token>`.
 * No token or an unrecognized one → 401. Recognized but missing the
 * scope the route requires → 403. The tokens file itself failing to
 * load (missing/corrupt) fails closed — 503, never "treat as no auth".
 */
import type { Context, MiddlewareHandler } from 'hono'
import { findToken, loadUtaTokens, resolveUtaTokensFilePath } from '../domain/trading/auth/tokens-file.js'
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

export function utaAuthMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const tokensPath = resolveUtaTokensFilePath()
    if (!tokensPath) return next()  // compatibility mode — see deployment-safety.ts

    const loaded = await loadUtaTokens(tokensPath)
    if (!loaded.ok) {
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
