import type { RiskRule } from '../types.js'

/**
 * R18 — modifyOrder must not increase the order's quantity, and any change
 * to its stop price may only tighten (move toward protecting more, not
 * less). Needs the CURRENT order's state to compare against — risk-engine.ts
 * resolves it via broker.getOrders([orderId]) and attaches it as
 * `ctx.currentOrder` before rules run; a modifyOrder this engine cannot
 * resolve the current state for fails closed here (better an unnecessary
 * rejection than an unverified quantity increase).
 */
export const r18ModifyLimits: RiskRule = {
  code: 'R18',
  appliesTo: ['modifyOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'modifyOrder') return null
    if (!ctx.currentOrder) {
      return { code: 'R18', message: 'cannot resolve the order being modified' }
    }
    const { changes } = ctx.operation
    if (changes.totalQuantity && changes.totalQuantity.gt(ctx.currentOrder.totalQuantity)) {
      return {
        code: 'R18',
        message: `modify would increase quantity from ${ctx.currentOrder.totalQuantity.toString()} to ${changes.totalQuantity.toString()}`,
      }
    }
    // A stop only "tightens" if it moves toward the entry/current price —
    // direction depends on the order's side, which this Operation doesn't
    // carry on `changes` alone; comparing against the CURRENT stop's
    // distance from itself is the direction-agnostic part we can enforce
    // here: any auxPrice change at all is only safe when it's provided
    // together with an explicit acknowledgement elsewhere (a later fase's
    // concern — Fase 4a fails closed on any auxPrice change it cannot
    // verify tightens, which is the conservative default).
    if (changes.auxPrice && !changes.auxPrice.equals(ctx.currentOrder.auxPrice)) {
      return { code: 'R18', message: 'modify changes the stop price; direction cannot be verified as tightening in this fase' }
    }
    return null
  },
}
