/**
 * [PROPUESTA] Engine-account guard — Fase 4d, S1.
 *
 * For accounts the RO risk policy marks `engineOwned: true`
 * (`domain/trading/risk/policy.ts`), staging or committing requires the
 * caller's token to carry the `engine` scope specifically — not merely
 * any token with `stage` (e.g. `operator-cli`). Push is untouched here:
 * it still requires `approve` (Fase 4b), and `TradingGit` allows only
 * one pending commit at a time (`add()`/`commit()` throw otherwise,
 * [VERIFICADO EN REPOSITORIO] `git/TradingGit.ts:81-85`), so whatever
 * gets pushed on an Engine-owned account can only ever be the commit the
 * Engine itself staged — "HUMAN_APPROVAL mode" falls out of that
 * invariant plus this guard, without needing a second mechanism to
 * track "who created this pendingHash."
 *
 * Mounted after `utaAuthMiddleware` — reads `c.get('utaAuth')`, which is
 * only set in enforced mode. In compatibility mode (no tokens file)
 * there is nothing to check a scope against, so this guard no-ops, same
 * as every other Fase 4b/4c control in that mode.
 */
import type { Context, MiddlewareHandler } from 'hono'
import { requiredScope } from './auth.js'
import type { UtaAuthInfo } from './auth.js'
import { loadRiskPolicy, resolveAccountPolicy, resolveRiskPolicyPath } from '../domain/trading/risk/policy.js'

function accountIdFromPath(path: string): string | undefined {
  const match = /\/uta\/([^/]+)/.exec(path)
  return match?.[1]
}

export function engineAccountGuard(): MiddlewareHandler {
  return async (c: Context, next) => {
    const auth = c.get('utaAuth') as UtaAuthInfo | undefined
    if (!auth) return next()  // compatibility mode — nothing to check

    const scope = requiredScope(c.req.method, c.req.path)
    if (scope !== 'stage') return next()  // only stage/commit routes are gated here

    const accountId = accountIdFromPath(c.req.path)
    if (!accountId) return next()

    const policyResult = await loadRiskPolicy(resolveRiskPolicyPath())
    if (!policyResult.ok) return next()  // no policy configured — RiskEngine's own gates handle that separately
    const accountPolicy = resolveAccountPolicy(policyResult.policy, accountId)
    if (!accountPolicy?.engineOwned) return next()

    if (!auth.scopes.includes('engine')) {
      return c.json({
        error: 'Forbidden',
        code: 'ENGINE_ACCOUNT_REQUIRES_ENGINE_SCOPE',
        detail: `account "${accountId}" is Engine-managed — only a token with the "engine" scope may stage or commit on it`,
      }, 403)
    }
    return next()
  }
}
