import type { RiskRule } from '../types.js'

/**
 * R2 — the account itself must resolve a policy at all. By the time a rule
 * runs, risk-engine.ts has already resolved `ctx.policy` (failing closed
 * upstream when no account/default entry exists) — this rule exists as an
 * explicit, auditable checkpoint in the R0-R20 sequence rather than being
 * silently implied by "the engine wouldn't have gotten this far otherwise".
 */
export const r2Account: RiskRule = {
  code: 'R2',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (!ctx.accountId) return { code: 'R2', message: 'no account id on operation context' }
    return null
  },
}
