import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { r0KillSwitch } from './rules/r0-kill-switch.js'
import { r1ActionAllowed } from './rules/r1-action-allowed.js'
import { r3SymbolSecType } from './rules/r3-symbol-sectype.js'
import { r4TradingHours } from './rules/r4-trading-hours.js'
import { r5QuoteFreshness } from './rules/r5-quote-freshness.js'
import { r6PriceBand } from './rules/r6-price-band.js'
import { r7OrderNotional } from './rules/r7-order-notional.js'
import { r8ResultingPosition } from './rules/r8-resulting-position.js'
import { r9Exposure } from './rules/r9-exposure.js'
import { r10Leverage } from './rules/r10-leverage.js'
import { r11OpenPositions } from './rules/r11-open-positions.js'
import { r12TradesPerDay } from './rules/r12-trades-per-day.js'
import { r13Cooldown } from './rules/r13-cooldown.js'
import { r14StopRequired } from './rules/r14-stop-required.js'
import { r15RiskPerTrade } from './rules/r15-risk-per-trade.js'
import { r16DailyLoss } from './rules/r16-daily-loss.js'
import { r17Drawdown } from './rules/r17-drawdown.js'
import { r18ModifyLimits } from './rules/r18-modify-limits.js'
import { r19ConsecutiveRejects } from './rules/r19-consecutive-rejects.js'
import { r20CapitalCap } from './rules/r20-capital-cap.js'
import { r21MaxSpread } from './rules/r21-max-spread.js'
import { makeRiskContext, makeAccountPolicy, makePlaceOrder, makeModifyOrder, makeAccountInfo, makePosition, makeContract } from './test-fixtures.js'
import { initialRiskState } from './risk-state.js'

describe('R0 kill switch', () => {
  it('blocks when NOT NORMAL', () => {
    const ctx = makeRiskContext({ state: { ...initialRiskState('d'), killSwitch: 'HALT_NEW' } })
    expect(r0KillSwitch.check(ctx)?.code).toBe('R0')
  })
  it('allows when NORMAL', () => {
    expect(r0KillSwitch.check(makeRiskContext())).toBeNull()
  })
})

describe('R1 action allowed', () => {
  it('blocks an action not in allowedActions', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ allowedActions: ['closePosition'] }) })
    expect(r1ActionAllowed.check(ctx)?.code).toBe('R1')
  })
  it('allows when unrestricted', () => {
    expect(r1ActionAllowed.check(makeRiskContext())).toBeNull()
  })
})

describe('R3 symbol/secType', () => {
  it('blocks a symbol not in allowedSymbols', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ allowedSymbols: ['MSFT'] }), operation: makePlaceOrder({ symbol: 'AAPL' }) })
    expect(r3SymbolSecType.check(ctx)?.code).toBe('R3')
  })
  it('allows a listed symbol', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ allowedSymbols: ['AAPL'] }), operation: makePlaceOrder({ symbol: 'AAPL' }) })
    expect(r3SymbolSecType.check(ctx)).toBeNull()
  })
})

describe('R4 trading hours', () => {
  it('skips entirely when policy is "always"', () => {
    expect(r4TradingHours.check(makeRiskContext({ policy: makeAccountPolicy({ tradingHours: 'always' }), marketClock: undefined }))).toBeNull()
  })
  it('fails closed when marketHours and clock is unavailable', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ tradingHours: 'marketHours' }), marketClock: undefined })
    expect(r4TradingHours.check(ctx)?.code).toBe('R4')
  })
  it('blocks when market is closed', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ tradingHours: 'marketHours' }), marketClock: { isOpen: false } })
    expect(r4TradingHours.check(ctx)?.code).toBe('R4')
  })
})

describe('R5 quote freshness', () => {
  it('fails closed with no quote', () => {
    expect(r5QuoteFreshness.check(makeRiskContext({ quote: undefined }))?.code).toBe('R5')
  })
  it('blocks a stale quote', () => {
    const ctx = makeRiskContext({
      now: new Date('2026-09-25T12:01:00.000Z'),
      policy: makeAccountPolicy({ maxQuoteAgeSeconds: 10 }),
      quote: { contract: makeContract(), last: '100', bid: '99.9', ask: '100.1', volume: '1', timestamp: new Date('2026-09-25T12:00:00.000Z') },
    })
    expect(r5QuoteFreshness.check(ctx)?.code).toBe('R5')
  })
  it('allows a fresh quote at the exact boundary', () => {
    const ctx = makeRiskContext({
      now: new Date('2026-09-25T12:00:10.000Z'),
      policy: makeAccountPolicy({ maxQuoteAgeSeconds: 10 }),
      quote: { contract: makeContract(), last: '100', bid: '99.9', ask: '100.1', volume: '1', timestamp: new Date('2026-09-25T12:00:00.000Z') },
    })
    expect(r5QuoteFreshness.check(ctx)).toBeNull()
  })
})

describe('R6 price band', () => {
  const quote = { contract: makeContract(), last: '100', bid: '99.9', ask: '100.1', volume: '1', timestamp: new Date('2026-09-25T12:00:00.000Z') }
  it('blocks a limit price far outside the band', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ priceBandPct: 1 }), operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 150 }), quote })
    expect(r6PriceBand.check(ctx)?.code).toBe('R6')
  })
  it('allows a limit price within the band', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ priceBandPct: 5 }), operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 101 }), quote })
    expect(r6PriceBand.check(ctx)).toBeNull()
  })
})

describe('R7 order notional', () => {
  it('blocks an order exceeding maxOrderNotional', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ maxOrderNotional: 500 }), operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 100, totalQuantity: 10 }) })
    expect(r7OrderNotional.check(ctx)?.code).toBe('R7')
  })
  it('allows an order at the limit', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ maxOrderNotional: 1000 }), operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 100, totalQuantity: 10 }) })
    expect(r7OrderNotional.check(ctx)).toBeNull()
  })
  it('fails closed when notional cannot be estimated (market order, no quote)', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ maxOrderNotional: 1000 }), operation: makePlaceOrder({ orderType: 'MKT' }), quote: undefined })
    expect(r7OrderNotional.check(ctx)?.code).toBe('R7')
  })
})

describe('R8 resulting position', () => {
  it('blocks when the resulting position % of equity is too large', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxPositionPctEquity: 10 }),
      account: makeAccountInfo({ netLiquidation: '10000' }),
      operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 100, totalQuantity: 50 }), // 5000 notional = 50% of equity
    })
    expect(r8ResultingPosition.check(ctx)?.code).toBe('R8')
  })
  it('accounts for an existing position when computing the resulting total', () => {
    const contract = makeContract({ symbol: 'AAPL' })
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxPositionNotional: 1000 }),
      positions: [makePosition({ contract, marketValue: '900' })],
      operation: makePlaceOrder({ symbol: 'AAPL', orderType: 'LMT', lmtPrice: 100, totalQuantity: 2 }), // +200 -> 1100 total
    })
    expect(r8ResultingPosition.check(ctx)?.code).toBe('R8')
  })
})

describe('R9 exposure', () => {
  it('blocks when resulting gross exposure exceeds the % equity cap', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxGrossExposurePctEquity: 50 }),
      account: makeAccountInfo({ netLiquidation: '10000' }),
      positions: [makePosition({ marketValue: '4000' })],
      operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 100, totalQuantity: 20 }), // +2000 -> 6000/10000 = 60%
    })
    expect(r9Exposure.check(ctx)?.code).toBe('R9')
  })
})

describe('R10 leverage', () => {
  it('blocks when resulting leverage exceeds maxLeverage', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxLeverage: 2 }),
      account: makeAccountInfo({ netLiquidation: '1000' }),
      operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 100, totalQuantity: 30 }), // 3000 notional / 1000 equity = 3x
    })
    expect(r10Leverage.check(ctx)?.code).toBe('R10')
  })
})

describe('R11 open positions', () => {
  it('blocks opening a new symbol beyond maxOpenPositions', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxOpenPositions: 1 }),
      positions: [makePosition({ contract: makeContract({ symbol: 'MSFT' }) })],
      operation: makePlaceOrder({ symbol: 'AAPL' }),
    })
    expect(r11OpenPositions.check(ctx)?.code).toBe('R11')
  })
  it('allows adding to an existing position without increasing the count', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxOpenPositions: 1 }),
      positions: [makePosition({ contract: makeContract({ symbol: 'AAPL' }) })],
      operation: makePlaceOrder({ symbol: 'AAPL' }),
    })
    expect(r11OpenPositions.check(ctx)).toBeNull()
  })
})

describe('R12 trades per day', () => {
  it('blocks once maxTradesPerDay is reached', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ maxTradesPerDay: 2 }), state: { ...initialRiskState('d'), tradesToday: 2 } })
    expect(r12TradesPerDay.check(ctx)?.code).toBe('R12')
  })
  it('blocks once maxTradesPerSymbolPerDay is reached for that symbol', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxTradesPerSymbolPerDay: 1 }),
      state: { ...initialRiskState('d'), tradesTodayBySymbol: { AAPL: 1 } },
      operation: makePlaceOrder({ symbol: 'AAPL' }),
    })
    expect(r12TradesPerDay.check(ctx)?.code).toBe('R12')
  })
})

describe('R13 cooldown', () => {
  it('blocks while a symbol is on cooldown', () => {
    const ctx = makeRiskContext({
      now: new Date('2026-09-25T12:00:00.000Z'),
      state: { ...initialRiskState('d'), cooldownUntil: { AAPL: '2026-09-25T12:05:00.000Z' } },
      operation: makePlaceOrder({ symbol: 'AAPL' }),
    })
    expect(r13Cooldown.check(ctx)?.code).toBe('R13')
  })
  it('allows once the cooldown has elapsed', () => {
    const ctx = makeRiskContext({
      now: new Date('2026-09-25T12:06:00.000Z'),
      state: { ...initialRiskState('d'), cooldownUntil: { AAPL: '2026-09-25T12:05:00.000Z' } },
      operation: makePlaceOrder({ symbol: 'AAPL' }),
    })
    expect(r13Cooldown.check(ctx)).toBeNull()
  })
})

describe('R14 stop required', () => {
  it('blocks a placeOrder with no protective stop', () => {
    expect(r14StopRequired.check(makeRiskContext({ operation: makePlaceOrder({ orderType: 'MKT' }) }))?.code).toBe('R14')
  })
  it('allows with an attached stopLoss', () => {
    expect(r14StopRequired.check(makeRiskContext({ operation: makePlaceOrder({ orderType: 'MKT', stopLossPrice: 90 }) }))).toBeNull()
  })
  it('allows a native STP order (the order IS the stop)', () => {
    expect(r14StopRequired.check(makeRiskContext({ operation: makePlaceOrder({ orderType: 'STP', auxPrice: 90 }) }))).toBeNull()
  })
  it('is skipped when the policy does not require a stop', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ requireStopLoss: false }), operation: makePlaceOrder({ orderType: 'MKT' }) })
    expect(r14StopRequired.check(ctx)).toBeNull()
  })
})

describe('R15 risk per trade', () => {
  it('blocks a trade risking more than maxRiskPerTradePctEquity', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxRiskPerTradePctEquity: 1 }),
      account: makeAccountInfo({ netLiquidation: '10000' }),
      operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 100, totalQuantity: 100, stopLossPrice: 98 }), // risk = 2*100=200 = 2% of 10000
    })
    expect(r15RiskPerTrade.check(ctx)?.code).toBe('R15')
  })
  it('allows a trade within the risk budget', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxRiskPerTradePctEquity: 5 }),
      account: makeAccountInfo({ netLiquidation: '10000' }),
      operation: makePlaceOrder({ orderType: 'LMT', lmtPrice: 100, totalQuantity: 100, stopLossPrice: 98 }),
    })
    expect(r15RiskPerTrade.check(ctx)).toBeNull()
  })
})

describe('R16 daily loss', () => {
  it('blocks and triggers HALT_NEW when the daily loss exceeds the limit', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxDailyLossPctEquity: 5 }),
      account: makeAccountInfo({ netLiquidation: '9000' }),
      state: { ...initialRiskState('d'), dailyStartEquity: '10000' }, // 10% loss
    })
    const result = r16DailyLoss.check(ctx)
    expect(result?.code).toBe('R16')
    expect(result?.killSwitch).toBe('HALT_NEW')
  })
  it('allows when within the daily loss budget', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxDailyLossPctEquity: 5 }),
      account: makeAccountInfo({ netLiquidation: '9800' }),
      state: { ...initialRiskState('d'), dailyStartEquity: '10000' }, // 2% loss
    })
    expect(r16DailyLoss.check(ctx)).toBeNull()
  })
})

describe('R17 drawdown', () => {
  it('blocks and triggers HALT_NEW when drawdown from HWM exceeds the limit', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxDrawdownPctFromHWM: 10 }),
      account: makeAccountInfo({ netLiquidation: '8000' }),
      state: { ...initialRiskState('d'), highWaterMarkEquity: '10000' }, // 20% drawdown
    })
    const result = r17Drawdown.check(ctx)
    expect(result?.code).toBe('R17')
    expect(result?.killSwitch).toBe('HALT_NEW')
  })
})

describe('R18 modify limits', () => {
  it('fails closed when the current order state cannot be resolved', () => {
    expect(r18ModifyLimits.check(makeRiskContext({ operation: makeModifyOrder({ totalQuantity: 5 }), currentOrder: undefined }))?.code).toBe('R18')
  })
  it('blocks a modify that increases the order quantity (position enlargement)', () => {
    const ctx = makeRiskContext({
      operation: makeModifyOrder({ totalQuantity: 20 }),
      currentOrder: { totalQuantity: new Decimal(10), auxPrice: new Decimal(0), lmtPrice: new Decimal(0), contract: makeContract() },
    })
    expect(r18ModifyLimits.check(ctx)?.code).toBe('R18')
  })
})

describe('R19 consecutive rejects', () => {
  it('triggers HALT_NEW once maxConsecutiveRejects is reached', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ maxConsecutiveRejects: 3 }), state: { ...initialRiskState('d'), consecutiveRejects: 3 } })
    const result = r19ConsecutiveRejects.check(ctx)
    expect(result?.code).toBe('R19')
    expect(result?.killSwitch).toBe('HALT_NEW')
  })
})

describe('R20 capital cap', () => {
  it('blocks when account equity exceeds capitalCap', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ capitalCap: 5000 }), account: makeAccountInfo({ netLiquidation: '6000' }) })
    expect(r20CapitalCap.check(ctx)?.code).toBe('R20')
  })
  it('allows at or below capitalCap', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ capitalCap: 5000 }), account: makeAccountInfo({ netLiquidation: '5000' }) })
    expect(r20CapitalCap.check(ctx)).toBeNull()
  })
})

describe('R21 max spread (Fase 4c, A7a)', () => {
  it('is a no-op when maxSpreadBps is not configured', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({}),
      quote: { contract: makeContract(), last: '100', bid: '90', ask: '110', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)).toBeNull()
  })

  it('fails closed with no quote at all', () => {
    const ctx = makeRiskContext({ policy: makeAccountPolicy({ maxSpreadBps: 50 }), quote: undefined })
    expect(r21MaxSpread.check(ctx)?.code).toBe('R21')
  })

  it('rejects when bid/ask is unavailable (broker reports the 0 sentinel — CCXT/IBKR when the ticker has none)', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 50 }),
      quote: { contract: makeContract(), last: '100', bid: '0', ask: '0', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)?.code).toBe('R21')
  })

  it('rejects a negative bid (defensive — should never happen, but never silently divide by it)', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 50 }),
      quote: { contract: makeContract(), last: '100', bid: '-1', ask: '100', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)?.code).toBe('R21')
  })

  it('rejects bid === ask by default (Leverup-style synthetic quote — bid=ask=last)', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 50 }),
      quote: { contract: makeContract(), last: '100', bid: '100', ask: '100', volume: '1', timestamp: new Date() },
    })
    const result = r21MaxSpread.check(ctx)
    expect(result?.code).toBe('R21')
    expect(result?.message).toContain('allowSyntheticQuotes')
  })

  it('rejects a crossed quote (bid > ask) by default', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 50 }),
      quote: { contract: makeContract(), last: '100', bid: '101', ask: '99', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)?.code).toBe('R21')
  })

  it('allowSyntheticQuotes:true accepts a Leverup-style bid===ask quote instead of rejecting', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 50, allowSyntheticQuotes: true }),
      quote: { contract: makeContract(), last: '100', bid: '100', ask: '100', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)).toBeNull()
  })

  it('allowSyntheticQuotes:true also accepts a crossed quote (no meaningful spread is computed, the rule just does not apply)', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 50, allowSyntheticQuotes: true }),
      quote: { contract: makeContract(), last: '100', bid: '101', ask: '99', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)).toBeNull()
  })

  it('allowSyntheticQuotes:true also accepts a non-positive (absent) quote', () => {
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 50, allowSyntheticQuotes: true }),
      quote: { contract: makeContract(), last: '100', bid: '0', ask: '0', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)).toBeNull()
  })

  it('allowSyntheticQuotes:true does NOT weaken a real, wide spread — that still rejects normally', () => {
    // bid=90, ask=110, mid=100 -> 2000bps, well over the 50bps limit, and not a synthetic shape.
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 50, allowSyntheticQuotes: true }),
      quote: { contract: makeContract(), last: '100', bid: '90', ask: '110', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)?.code).toBe('R21')
  })

  it('blocks when the spread exceeds the configured limit', () => {
    // bid=99, ask=101, mid=100 -> spread = 2/100 * 10_000 = 200bps
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 100 }),
      quote: { contract: makeContract(), last: '100', bid: '99', ask: '101', volume: '1', timestamp: new Date() },
    })
    const result = r21MaxSpread.check(ctx)
    expect(result?.code).toBe('R21')
    expect(result?.message).toContain('200.0bps')
  })

  it('allows a spread at or under the configured limit', () => {
    // bid=99.9, ask=100.1, mid=100 -> spread = 0.2/100 * 10_000 = 20bps
    const ctx = makeRiskContext({
      policy: makeAccountPolicy({ maxSpreadBps: 20 }),
      quote: { contract: makeContract(), last: '100', bid: '99.9', ask: '100.1', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)).toBeNull()
  })

  it('applies to modifyOrder too, not just placeOrder', () => {
    expect(r21MaxSpread.appliesTo).toContain('modifyOrder')
    const ctx = makeRiskContext({
      operation: makeModifyOrder({ totalQuantity: 1 }),
      policy: makeAccountPolicy({ maxSpreadBps: 50 }),
      quote: { contract: makeContract(), last: '100', bid: '0', ask: '0', volume: '1', timestamp: new Date() },
    })
    expect(r21MaxSpread.check(ctx)?.code).toBe('R21')
  })
})
