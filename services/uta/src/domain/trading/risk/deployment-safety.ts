/**
 * [PROPUESTA] Deployment-safety guard — Fase 4a, added 2026-09-26 to close
 * a real fail-open gap: a configured risk policy that is silently NOT
 * enforced (because someone forgot to also set the enable flag) is worse
 * than no policy at all — it *looks* governed but isn't. UTA refuses to
 * start rather than run in that state.
 *
 * Pure function (no I/O, no process.exit) so main.ts's actual startup
 * behavior stays a thin, testable wrapper — see main.ts's call site.
 */
export interface DeploymentSafetyCheck {
  ok: boolean
  /** Set when ok is false — the process must not start. */
  error?: string
  /** Set when ok is true but worth a loud startup log — the engine is intentionally disabled. */
  warn?: string
}

export function checkRiskEngineDeploymentSafety(env: NodeJS.ProcessEnv = process.env): DeploymentSafetyCheck {
  const policyPathSet = Boolean(env['OPENALICE_RISK_POLICY_PATH']?.trim())
  const engineEnabled = env['OPENALICE_RISK_ENGINE_ENABLED'] === '1'

  if (policyPathSet && !engineEnabled) {
    return {
      ok: false,
      error:
        'OPENALICE_RISK_POLICY_PATH is set but OPENALICE_RISK_ENGINE_ENABLED is not "1". ' +
        'A configured risk policy that is not actually enforced is a silent fail-open, not a ' +
        'disabled feature — refusing to start. Either set OPENALICE_RISK_ENGINE_ENABLED=1 to ' +
        'enforce it, or unset OPENALICE_RISK_POLICY_PATH if you really mean to run without a policy.',
    }
  }

  if (!engineEnabled) {
    return {
      ok: true,
      warn:
        '[uta] RiskEngine is DISABLED (OPENALICE_RISK_ENGINE_ENABLED is not "1") — no placeOrder/' +
        'modifyOrder risk checks will run; only the pre-existing guards apply. This is fine for ' +
        'local development. Production (Fase 10, docs/risk-engine.md) requires the flag set.',
    }
  }

  return { ok: true }
}
