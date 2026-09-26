/** [PROPUESTA] Shared helpers for the R0-R20 rule files — not a rule itself. */
import Decimal from 'decimal.js'
import { UNSET_DECIMAL } from '@traderalice/ibkr'
import type { Order } from '@traderalice/ibkr'
import type { Quote } from '../../brokers/types.js'
import type { RiskContext } from '../types.js'

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
