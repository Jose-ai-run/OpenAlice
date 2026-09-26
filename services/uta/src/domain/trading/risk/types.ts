/**
 * [PROPUESTA] RiskEngine shared types — Fase 4a.
 *
 * Behind OPENALICE_RISK_ENGINE_ENABLED (default off). With the flag off,
 * none of this module is invoked — UnifiedTradingAccount's dispatcher is
 * byte-identical to before Fase 4a. See risk-engine.ts for the insertion
 * point (M1, PROMPT_MASTER_CLAUDE_CODE.md §5).
 */
import type Decimal from 'decimal.js'
import type { Contract } from '@traderalice/ibkr'
import type { Operation } from '../git/types.js'
import type { Position, AccountInfo, Quote, MarketClock } from '../brokers/types.js'
import type { AccountRiskPolicy } from './policy.js'
import type { RiskState } from './risk-state.js'

/** Assembled once per operation by risk-engine.ts, then handed to every pure rule. */
export interface RiskContext {
  accountId: string
  operation: Operation
  policy: AccountRiskPolicy
  policyHash: string
  positions: readonly Position[]
  account: Readonly<AccountInfo>
  state: Readonly<RiskState>
  /** Present for placeOrder/modifyOrder when the broker could resolve one; absent = rule R5/R6 fail closed. */
  quote?: Quote
  /** Present when the broker could resolve one; absent = R4 fails closed unless policy.tradingHours === 'always'. */
  marketClock?: MarketClock
  /** For modifyOrder only — the order's CURRENT state, resolved via broker.getOrders([orderId]) before rules run. Absent = R18 fails closed. */
  currentOrder?: { totalQuantity: Decimal; auxPrice: Decimal; lmtPrice: Decimal; contract: Contract }
  now: Date
}

export interface RiskRuleRejection {
  code: string
  message: string
  /** If set, the engine also transitions the persistent kill switch to this state. */
  killSwitch?: 'HALT_NEW' | 'FLATTEN'
}

export type RiskRuleResult = RiskRuleRejection | null

export interface RiskRule {
  /** 'R0'..'R20' — matches PROMPT_MASTER_CLAUDE_CODE.md §14's numbering. */
  code: string
  /** Which operation kinds this rule evaluates. Rules never see closePosition/cancelOrder — those are always allowed per §14, the engine never calls into the rule chain for them. */
  appliesTo: ReadonlyArray<'placeOrder' | 'modifyOrder'>
  check(ctx: RiskContext): RiskRuleResult
}

export interface RiskVerdict {
  allowed: boolean
  /** The rejecting rule's code, or undefined when allowed. */
  ruleCode?: string
  reason?: string
  policyHash: string
  killSwitch: 'NORMAL' | 'HALT_NEW' | 'FLATTEN'
}
