import Decimal from 'decimal.js'
import { Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import type { AccountInfo } from '../brokers/types.js'
import { makeContract, makePosition } from '../brokers/mock/index.js'
import { initialRiskState } from './risk-state.js'
import type { AccountRiskPolicy } from './policy.js'
import type { RiskContext } from './types.js'
import type { Operation } from '../git/types.js'

export function makeAccountInfo(overrides: Partial<AccountInfo> = {}): AccountInfo {
  return {
    baseCurrency: 'USD',
    netLiquidation: '100000',
    totalCashValue: '100000',
    unrealizedPnL: '0',
    ...overrides,
  }
}

export function makeAccountPolicy(overrides: Partial<AccountRiskPolicy> = {}): AccountRiskPolicy {
  return {
    tradingHours: 'always',
    requireStopLoss: true,
    maxQuoteAgeSeconds: 30,
    allowSyntheticQuotes: false,
    engineOwned: false,
    ...overrides,
  }
}

export function makePlaceOrder(overrides: {
  symbol?: string
  action?: 'BUY' | 'SELL'
  orderType?: string
  totalQuantity?: number
  lmtPrice?: number
  auxPrice?: number
  stopLossPrice?: number
} = {}): Extract<Operation, { action: 'placeOrder' }> {
  const contract = makeContract({ symbol: overrides.symbol ?? 'AAPL' })
  const order = new Order()
  order.action = overrides.action ?? 'BUY'
  order.orderType = overrides.orderType ?? 'MKT'
  order.totalQuantity = overrides.totalQuantity !== undefined ? new Decimal(overrides.totalQuantity) : new Decimal(10)
  if (overrides.lmtPrice !== undefined) order.lmtPrice = new Decimal(overrides.lmtPrice)
  if (overrides.auxPrice !== undefined) order.auxPrice = new Decimal(overrides.auxPrice)
  return {
    action: 'placeOrder',
    contract,
    order,
    tpsl: overrides.stopLossPrice !== undefined ? { stopLoss: { price: String(overrides.stopLossPrice) } } : undefined,
  }
}

export function makeModifyOrder(overrides: { orderId?: string; totalQuantity?: number; auxPrice?: number } = {}): Extract<Operation, { action: 'modifyOrder' }> {
  const changes: Partial<InstanceType<typeof Order>> = {}
  if (overrides.totalQuantity !== undefined) changes.totalQuantity = new Decimal(overrides.totalQuantity)
  if (overrides.auxPrice !== undefined) changes.auxPrice = new Decimal(overrides.auxPrice)
  return { action: 'modifyOrder', orderId: overrides.orderId ?? 'order-1', changes }
}

export function makeRiskContext(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    accountId: 'mock-paper',
    operation: overrides.operation ?? makePlaceOrder(),
    policy: overrides.policy ?? makeAccountPolicy(),
    policyHash: 'testhash0000000',
    positions: overrides.positions ?? [],
    account: overrides.account ?? makeAccountInfo(),
    state: overrides.state ?? initialRiskState('2026-09-25'),
    quote: overrides.quote,
    marketClock: overrides.marketClock,
    currentOrder: overrides.currentOrder,
    now: overrides.now ?? new Date('2026-09-25T12:00:00.000Z'),
    ...overrides,
  }
}

export { makeContract, makePosition, UNSET_DECIMAL }
