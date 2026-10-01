import type { RiskRule } from '../types.js'
import { isProtectiveStopOrder } from './shared.js'

function opposite(action: string): string {
  return action === 'BUY' ? 'SELL' : 'BUY'
}

/**
 * [PROPUESTA] Hito 1 Parte 2 (AUDIT.md §19, item 1b) — R14 now evaluates the
 * WHOLE commit, not just this one operation: an entry passes if the SAME
 * commit also contains its protective stop (opposite side, same symbol,
 * quantity covering the entry). Order within the commit is entry -> stop
 * (checked here by symbol/side/qty, not by index — a rule has no business
 * enforcing array order, only that the sibling exists).
 */
function hasCoveringSiblingStop(ctx: Parameters<RiskRule['check']>[0]): boolean {
  if (ctx.operation.action !== 'placeOrder' || !ctx.siblingOperations) return false
  const entry = ctx.operation
  const entrySymbol = entry.contract.localSymbol || entry.contract.symbol
  const needsCoverFrom = opposite(entry.order.action)
  return ctx.siblingOperations.some((sibling) => {
    if (sibling === ctx.operation || sibling.action !== 'placeOrder') return false
    if (!isProtectiveStopOrder(sibling)) return false
    const siblingSymbol = sibling.contract.localSymbol || sibling.contract.symbol
    if (siblingSymbol !== entrySymbol) return false
    if (sibling.order.action !== needsCoverFrom) return false
    return sibling.order.totalQuantity.gte(entry.order.totalQuantity)
  })
}

/** R14 — a protective stop is obligatory: an attached stopLoss (tpsl), the order itself is a stop type, or a covering sibling stop exists in the same commit. */
export const r14StopRequired: RiskRule = {
  code: 'R14',
  appliesTo: ['placeOrder'],
  check(ctx) {
    if (ctx.operation.action !== 'placeOrder') return null
    if (!ctx.policy.requireStopLoss) return null
    const hasAttachedStop = Boolean(ctx.operation.tpsl?.stopLoss)
    if (hasAttachedStop) return null
    if (isProtectiveStopOrder(ctx.operation)) return null
    if (hasCoveringSiblingStop(ctx)) return null
    return { code: 'R14', message: 'no protective stop attached, order is not itself a stop type, and no covering stop exists in the same commit' }
  },
}
