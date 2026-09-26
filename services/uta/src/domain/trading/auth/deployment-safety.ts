/**
 * [PROPUESTA] UTA auth deployment-safety guard — Fase 4b, ADR-0003.
 *
 * Mirrors risk/deployment-safety.ts's shape and reasoning: a dangerous
 * configuration must refuse to start rather than silently run exposed.
 * Here the danger is binding UTA — the sole trading-write chokepoint — to
 * a non-loopback interface with no token file to authenticate callers.
 * On loopback, no tokens file configured is accepted as today's
 * behavior (compatibility mode) but must warn loudly on every start.
 *
 * Pure function (no I/O, no process.exit) so main.ts's startup path stays
 * a thin, testable wrapper — see main.ts's call site.
 */
export interface DeploymentSafetyCheck {
  ok: boolean
  /** Set when ok is false — the process must not start. */
  error?: string
  /** Set when ok is true but worth a loud startup log — auth is intentionally disabled. */
  warn?: string
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function resolveUtaBindHost(env: NodeJS.ProcessEnv = process.env): string {
  return env['OPENALICE_UTA_BIND_HOST']?.trim() || '127.0.0.1'
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

export function checkUtaAuthDeploymentSafety(env: NodeJS.ProcessEnv = process.env): DeploymentSafetyCheck {
  const bindHost = resolveUtaBindHost(env)
  const tokensFileSet = Boolean(env['OPENALICE_UTA_TOKENS_FILE']?.trim())

  if (!isLoopbackHost(bindHost) && !tokensFileSet) {
    return {
      ok: false,
      error:
        `OPENALICE_UTA_BIND_HOST is set to "${bindHost}" (non-loopback) but OPENALICE_UTA_TOKENS_FILE ` +
        'is not configured. UTA is the sole trading-write chokepoint — binding it off loopback with ' +
        'no bearer-token file would expose every account to any host that can reach this port. ' +
        'Either set OPENALICE_UTA_TOKENS_FILE to enforce auth, or bind to loopback.',
    }
  }

  if (!tokensFileSet) {
    return {
      ok: true,
      warn:
        '[uta] auth is DISABLED (compatibility mode) — OPENALICE_UTA_TOKENS_FILE is not configured. ' +
        'Every request reaching this port is trusted with no bearer-token check; the host boundary ' +
        '(loopback bind) is the only protection. Set OPENALICE_UTA_TOKENS_FILE to require ' +
        '`Authorization: Bearer <token>` with scopes. See docs/uta-auth.md.',
    }
  }

  return { ok: true }
}
