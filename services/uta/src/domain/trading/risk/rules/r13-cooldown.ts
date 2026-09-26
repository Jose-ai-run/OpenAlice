import type { RiskRule } from '../types.js'

/**
 * R13 — per-symbol cooldown, enforced from the persistent risk state (not
 * the in-memory, dispatch-order-dependent CooldownGuard — see M3 in
 * cooldown.ts, which now only records a cooldown after a DISPATCH SUCCEEDS,
 * fixing the Fase 0 finding that it used to record on check alone).
 */
export const r13Cooldown: RiskRule = {
  code: 'R13',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    const symbol = ctx.operation.contract.symbol
    const until = ctx.state.cooldownUntil[symbol]
    if (until && new Date(until).getTime() > ctx.now.getTime()) {
      return { code: 'R13', message: `cooldown active for "${symbol}" until ${until}` }
    }
    return null
  },
}
