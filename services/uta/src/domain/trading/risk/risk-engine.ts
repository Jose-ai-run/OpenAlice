/**
 * [PROPUESTA] RiskEngine orchestrator — Fase 4a.
 *
 * Assembles a RiskContext (policy, positions, account, persistent state,
 * quote, market clock, and — for modifyOrder — the order's current state),
 * then runs the R0-R20 rule chain in order for placeOrder/modifyOrder.
 * closePosition/cancelOrder never reach this function — the caller
 * (risk-dispatcher.ts) always allows them directly, per
 * PROMPT_MASTER_CLAUDE_CODE.md §14.
 *
 * Fail-closed by construction: any missing/invalid policy, or any
 * exception while gathering context, resolves to a rejected verdict with
 * `killSwitch: 'HALT_NEW'` rather than throwing — a RiskEngine that can
 * crash the dispatcher is worse than one that blocks trading.
 */
import Decimal from 'decimal.js'
import type { IBroker } from '../brokers/types.js'
import type { Operation } from '../git/types.js'
import { loadRiskPolicy, resolveAccountPolicy, resolveRiskPolicyPath } from './policy.js'
import { loadRiskStateStrict, saveRiskState, currentDayKey, type RiskState } from './risk-state.js'
import { triggerKillSwitch } from './kill-switch.js'
import { appendRiskDecision, toLogEntry } from './risk-log.js'
import type { RiskContext, RiskVerdict, RiskRule } from './types.js'

import { r0KillSwitch } from './rules/r0-kill-switch.js'
import { r1ActionAllowed } from './rules/r1-action-allowed.js'
import { r2Account } from './rules/r2-account.js'
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

export const RULE_CHAIN: readonly RiskRule[] = [
  r0KillSwitch, r1ActionAllowed, r2Account, r3SymbolSecType, r4TradingHours,
  r5QuoteFreshness, r6PriceBand, r7OrderNotional, r8ResultingPosition, r9Exposure,
  r10Leverage, r11OpenPositions, r12TradesPerDay, r13Cooldown, r14StopRequired,
  r15RiskPerTrade, r16DailyLoss, r17Drawdown, r18ModifyLimits, r19ConsecutiveRejects,
  r20CapitalCap,
]

export interface RiskEngineDeps {
  broker: IBroker
  accountId: string
  /** Injectable for hermetic tests. */
  now?: () => Date
  /** Injectable for hermetic tests — bypasses the real /etc/openalice path. */
  policyPath?: string
}

function haltVerdict(reason: string, policyHash = ''): RiskVerdict {
  return { allowed: false, ruleCode: 'POLICY', reason, policyHash, killSwitch: 'HALT_NEW' }
}

export async function evaluateRisk(operation: Operation, deps: RiskEngineDeps): Promise<RiskVerdict> {
  if (operation.action !== 'placeOrder' && operation.action !== 'modifyOrder') {
    return { allowed: true, policyHash: '', killSwitch: 'NORMAL' }
  }

  const now = (deps.now ?? (() => new Date()))()
  const accountId = deps.accountId

  const policyResult = await loadRiskPolicy(deps.policyPath ?? resolveRiskPolicyPath())
  if (!policyResult.ok) {
    return await finalize(accountId, operation, haltVerdict(`risk policy unavailable: ${policyResult.reason}`), now, undefined)
  }
  const accountPolicy = resolveAccountPolicy(policyResult.policy, accountId)
  if (!accountPolicy) {
    return await finalize(
      accountId, operation,
      haltVerdict(`no risk policy entry for account "${accountId}" (and no "default")`, policyResult.policyHash),
      now, undefined,
    )
  }
  const policyHash = policyResult.policyHash

  const stateResult = await loadRiskStateStrict(accountId, currentDayKey(now))
  if (!stateResult.ok) {
    return await finalize(accountId, operation, haltVerdict(stateResult.reason, policyHash), now, undefined)
  }
  let state: RiskState = stateResult.state

  let positions, account
  try {
    ;[positions, account] = await Promise.all([deps.broker.getPositions(), deps.broker.getAccount()])
  } catch (err) {
    return await finalize(
      accountId, operation,
      haltVerdict(`could not read account/positions: ${err instanceof Error ? err.message : String(err)}`, policyHash),
      now, state,
    )
  }

  const currentEquity = new Decimal(account.netLiquidation)
  if (!state.dailyStartEquity) state = { ...state, dailyStartEquity: currentEquity.toString() }
  const priorHwm = state.highWaterMarkEquity ? new Decimal(state.highWaterMarkEquity) : currentEquity
  state = { ...state, highWaterMarkEquity: Decimal.max(priorHwm, currentEquity).toString() }

  let currentOrder: RiskContext['currentOrder']
  if (operation.action === 'modifyOrder') {
    try {
      const orders = await deps.broker.getOrders([operation.orderId])
      const found = orders.find((o) => o.orderId === operation.orderId || String(o.order.orderId) === operation.orderId)
      if (found) {
        currentOrder = {
          totalQuantity: found.order.totalQuantity,
          auxPrice: found.order.auxPrice,
          lmtPrice: found.order.lmtPrice,
          contract: found.contract,
        }
      }
    } catch { /* leave undefined — R18 fails closed */ }
  }

  const contractForQuote = operation.action === 'placeOrder' ? operation.contract : currentOrder?.contract
  let quote: RiskContext['quote']
  let marketClock: RiskContext['marketClock']
  if (contractForQuote) {
    try { quote = await deps.broker.getQuote(contractForQuote) } catch { /* leave undefined — R5/R6 fail closed */ }
  }
  try { marketClock = await deps.broker.getMarketClock() } catch { /* leave undefined — R4 fails closed unless 'always' */ }

  const ctx: RiskContext = {
    accountId, operation, policy: accountPolicy, policyHash,
    positions, account, state, quote, marketClock, currentOrder, now,
  }

  for (const rule of RULE_CHAIN) {
    if (!rule.appliesTo.includes(operation.action)) continue
    const rejection = rule.check(ctx)
    if (rejection) {
      const verdict: RiskVerdict = {
        allowed: false, ruleCode: rejection.code, reason: rejection.message,
        policyHash, killSwitch: rejection.killSwitch ?? state.killSwitch,
      }
      return await finalizeRejected(accountId, operation, verdict, now, state, rejection.killSwitch)
    }
  }

  return await finalizeAllowed(accountId, operation, { allowed: true, policyHash, killSwitch: state.killSwitch }, now, state, accountPolicy)
}

/**
 * [PROPUESTA] Fail-closed on state-write failure — added 2026-09-26.
 *
 * `saveRiskState` already retries transient Windows EPERM/EBUSY (see
 * risk-state.ts). If it still fails after those retries, something is
 * fundamentally wrong with the persistence layer — disk full, permissions
 * changed under us, the volume gone. Continuing to operate on the
 * in-memory `state` as if the write had succeeded would mean every
 * counter this function tracks (consecutiveRejects, trades/day, cooldowns,
 * the kill switch itself) silently stops being durable while the process
 * keeps approving trades. That is worse than blocking: from here on,
 * EVERY verdict for this account is forced to `HALT_NEW`, not just this
 * one operation, and the failure is logged as its own diagnosable case
 * (`STATE_WRITE_FAILURE`), not left to surface as a generic thrown error.
 *
 * Returns `null` on success (caller proceeds with its own verdict), or a
 * forced verdict to return instead of whatever the rule chain decided.
 */
async function persistOrForceHalt(
  accountId: string, state: RiskState, operation: Operation, now: Date, policyHash: string,
): Promise<RiskVerdict | null> {
  try {
    await saveRiskState(accountId, state)
    return null
  } catch (err) {
    const message = `risk state write failed definitively: ${err instanceof Error ? err.message : String(err)}`
    console.error(`[uta:risk] ${message} — forcing HALT_NEW for account "${accountId}" (not continuing on in-memory state)`)
    // Best-effort: the underlying storage may be broken enough that even
    // this fails — swallow that specific failure, the in-process verdict
    // below is what actually protects the account either way.
    await saveRiskState(accountId, {
      ...state,
      killSwitch: 'HALT_NEW',
      killSwitchReason: `STATE_WRITE_FAILURE: ${message}`,
      killSwitchSetAt: now.toISOString(),
    }).catch(() => { /* best-effort only — already logged above */ })
    const verdict: RiskVerdict = { allowed: false, ruleCode: 'STATE_WRITE_FAILURE', reason: message, policyHash, killSwitch: 'HALT_NEW' }
    await appendRiskDecision(accountId, toLogEntry(accountId, operation, verdict, now)).catch(() => { /* best-effort */ })
    return verdict
  }
}

async function finalize(accountId: string, operation: Operation, verdict: RiskVerdict, now: Date, state: RiskState | undefined): Promise<RiskVerdict> {
  if (state) {
    const forced = await persistOrForceHalt(accountId, state, operation, now, verdict.policyHash)
    if (forced) return forced
  }
  await appendRiskDecision(accountId, toLogEntry(accountId, operation, verdict, now)).catch(() => { /* logging must never block a verdict */ })
  return verdict
}

async function finalizeRejected(
  accountId: string, operation: Operation, verdict: RiskVerdict, now: Date,
  state: RiskState, killSwitchTrigger?: 'HALT_NEW' | 'FLATTEN',
): Promise<RiskVerdict> {
  let next = { ...state, consecutiveRejects: state.consecutiveRejects + 1 }
  if (killSwitchTrigger) {
    next = await triggerKillSwitch(accountId, killSwitchTrigger, `${verdict.ruleCode}: ${verdict.reason}`, now)
    verdict = { ...verdict, killSwitch: next.killSwitch }
  } else {
    const forced = await persistOrForceHalt(accountId, next, operation, now, verdict.policyHash)
    if (forced) return forced
  }
  await appendRiskDecision(accountId, toLogEntry(accountId, operation, verdict, now)).catch(() => {})
  return verdict
}

async function finalizeAllowed(
  accountId: string, operation: Operation, verdict: RiskVerdict, now: Date,
  state: RiskState, accountPolicy: RiskContext['policy'],
): Promise<RiskVerdict> {
  let next = { ...state, consecutiveRejects: 0 }
  if (operation.action === 'placeOrder') {
    const symbol = operation.contract.symbol
    next = {
      ...next,
      tradesToday: next.tradesToday + 1,
      tradesTodayBySymbol: { ...next.tradesTodayBySymbol, [symbol]: (next.tradesTodayBySymbol[symbol] ?? 0) + 1 },
    }
    if (accountPolicy.cooldownSecondsPerSymbol) {
      next = {
        ...next,
        cooldownUntil: { ...next.cooldownUntil, [symbol]: new Date(now.getTime() + accountPolicy.cooldownSecondsPerSymbol * 1000).toISOString() },
      }
    }
  }
  const forced = await persistOrForceHalt(accountId, next, operation, now, verdict.policyHash)
  if (forced) return forced
  await appendRiskDecision(accountId, toLogEntry(accountId, operation, verdict, now)).catch(() => {})
  return verdict
}
