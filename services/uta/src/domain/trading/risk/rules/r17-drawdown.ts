import Decimal from 'decimal.js'
import type { RiskRule } from '../types.js'
import { equity } from './shared.js'

/** R17 — drawdown from the persistent high-water mark. Triggers HALT_NEW. risk-engine.ts updates the HWM before rules run, every evaluation. */
export const r17Drawdown: RiskRule = {
  code: 'R17',
  appliesTo: ['placeOrder', 'modifyOrder'],
  check(ctx) {
    if (!ctx.policy.maxDrawdownPctFromHWM) return null
    if (!ctx.state.highWaterMarkEquity) return null
    const hwm = new Decimal(ctx.state.highWaterMarkEquity)
    if (hwm.lte(0)) return null
    const current = equity(ctx)
    const drawdownPct = hwm.minus(current).div(hwm).mul(100)
    if (drawdownPct.gt(ctx.policy.maxDrawdownPctFromHWM)) {
      return {
        code: 'R17',
        message: `drawdown ${drawdownPct.toFixed(2)}% from HWM exceeds maxDrawdownPctFromHWM ${ctx.policy.maxDrawdownPctFromHWM}%`,
        killSwitch: 'HALT_NEW',
      }
    }
    return null
  },
}
