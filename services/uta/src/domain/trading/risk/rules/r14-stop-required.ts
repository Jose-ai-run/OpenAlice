import type { RiskRule } from '../types.js'

/** R14 — a protective stop is obligatory: either an attached stopLoss (tpsl), or the order itself is a stop type. */
export const r14StopRequired: RiskRule = {
  code: 'R14',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (!ctx.policy.requireStopLoss) return null
    const hasAttachedStop = Boolean(ctx.operation.tpsl?.stopLoss)
    const orderType = ctx.operation.order.orderType
    const isStopOrderItself = orderType === 'STP' || orderType === 'STP LMT' || orderType === 'TRAIL' || orderType === 'TRAIL LIMIT'
    if (!hasAttachedStop && !isStopOrderItself) {
      return { code: 'R14', message: 'no protective stop attached and order is not itself a stop type' }
    }
    return null
  },
}
