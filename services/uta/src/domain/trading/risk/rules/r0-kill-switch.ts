import type { RiskRule } from '../types.js'

/** R0 — kill switch. HALT_NEW/FLATTEN blocks all new placeOrder/modifyOrder. */
export const r0KillSwitch: RiskRule = {
  code: 'R0',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (ctx.state.killSwitch !== 'NORMAL') {
      return { code: 'R0', message: `kill switch is ${ctx.state.killSwitch}` }
    }
    return null
  },
}
