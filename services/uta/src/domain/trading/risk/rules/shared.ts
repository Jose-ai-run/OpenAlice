/** [PROPUESTA] Shared helpers for the R0-R20 rule files — not a rule itself. */
import Decimal from 'decimal.js'
import { UNSET_DECIMAL } from '@traderalice/ibkr'
import type { Order } from '@traderalice/ibkr'
import type { Operation } from '../../git/types.js'
import type { Quote } from '../../brokers/types.js'
import type { RiskContext } from '../types.js'

const STOP_ORDER_TYPES = new Set(['STP', 'STP LMT', 'TRAIL', 'TRAIL LIMIT'])

/**
 * [PROPUESTA] Hito 1 Parte 2, AUDIT.md §18/§19 — an order IS itself a
 * protective/reduce-only order by virtue of its order type. There is no
 * generic cross-broker `reduceOnly` flag on `Order` (it mirrors the IBKR
 * TWS API 1:1 — adding a crypto-exchange-shaped field there would be
 * foreign to that class) — order type is the real, existing signal R14
 * already used for "is this order itself a stop", reused here for R12/R13's
 * exemption and for MockBroker's orphan-stop guard.
 */
export function isProtectiveStopOrder(op: Operation): boolean {
  return op.action === 'placeOrder' && STOP_ORDER_TYPES.has(op.order.orderType)
}

export function estimateOrderPrice(order: Order, quote?: Quote): Decimal | null {
  if (!order.lmtPrice.equals(UNSET_DECIMAL) && order.lmtPrice.gt(0)) return order.lmtPrice
  if (!order.auxPrice.equals(UNSET_DECIMAL) && order.auxPrice.gt(0)) return order.auxPrice
  if (quote) return new Decimal(quote.last)
  return null
}

export function orderNotional(order: Order, quote?: Quote): Decimal | null {
  const price = estimateOrderPrice(order, quote)
  if (!price || order.totalQuantity.equals(UNSET_DECIMAL)) return null
  return price.mul(order.totalQuantity)
}

export function grossExposure(ctx: RiskContext): Decimal {
  return ctx.positions.reduce((sum, p) => sum.plus(new Decimal(p.marketValue).abs()), new Decimal(0))
}

export function netExposure(ctx: RiskContext): Decimal {
  return ctx.positions.reduce((sum, p) => sum.plus(new Decimal(p.marketValue)), new Decimal(0))
}

export function equity(ctx: RiskContext): Decimal {
  return new Decimal(ctx.account.netLiquidation)
}

/** Existing position for the operation's contract symbol, if any. */
export function existingPosition(ctx: RiskContext, symbol: string) {
  return ctx.positions.find((p) => p.contract.symbol === symbol)
}
