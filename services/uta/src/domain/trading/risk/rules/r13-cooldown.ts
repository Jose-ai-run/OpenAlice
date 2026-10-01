import type { RiskRule } from '../types.js'
import { isProtectiveStopOrder } from './shared.js'

/**
 * R13 — per-symbol cooldown, enforced from the persistent risk state (not
 * the in-memory, dispatch-order-dependent CooldownGuard — see M3 in
 * cooldown.ts, which now only records a cooldown after a DISPATCH SUCCEEDS,
 * fixing the Fase 0 finding that it used to record on check alone).
 *
 * Exempts protective-stop orders (AUDIT.md §19, item 1a): a real canary run
 * hit this for real — the entry armed the symbol's cooldown, then its own
 * protective STP order (staged in the same commit) was rejected by this
 * exact rule immediately after. A stop that reduces risk on a symbol must
 * never be blocked by the cooldown that symbol's own entry just armed.
 */
export const r13Cooldown: RiskRule = {
  code: 'R13',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (isProtectiveStopOrder(ctx.operation)) return null
    const symbol = ctx.operation.contract.symbol
    const until = ctx.state.cooldownUntil[symbol]
    if (until && new Date(until).getTime() > ctx.now.getTime()) {
      return { code: 'R13', message: `cooldown active for "${symbol}" until ${until}` }
    }
    return null
  },
}
