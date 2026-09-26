import type { OperationGuard, GuardContext } from './types.js'
import { getOperationSymbol } from '../git/types.js'
import { loadRiskState, saveRiskState, currentDayKey } from '../risk/risk-state.js'

const DEFAULT_MIN_INTERVAL_MS = 60_000

function riskEngineEnabled(): boolean {
  return process.env['OPENALICE_RISK_ENGINE_ENABLED'] === '1'
}

/**
 * [PROPUESTA] Fase 4a M3 fix, applied only when OPENALICE_RISK_ENGINE_ENABLED=1:
 *
 * Fase 0 found two defects here: (1) the timestamp was recorded as soon as
 * THIS guard's own `check()` passed, before knowing whether a later guard
 * in the pipeline would reject the whole operation; (2) state lived only
 * in an in-memory Map, lost on every UTA restart.
 *
 * Fixed behavior (flag on): `check()` no longer records anything — it
 * defers entirely to RiskEngine's R13 rule
 * (risk/rules/r13-cooldown.ts), which already reads the SAME persistent
 * state as the very first step of the dispatcher (M1), before this guard
 * even runs. This guard's only remaining job is `recordSuccess()`, which
 * writes the new cooldown ONLY after a dispatch actually succeeds.
 *
 * Flag off (the default): behaves EXACTLY as before Fase 4a, including
 * the documented defects above — this is deliberate, not an oversight;
 * see AUDIT.md for the "flag off = byte-identical" requirement this
 * satisfies.
 */
export class CooldownGuard implements OperationGuard {
  readonly name = 'cooldown'
  private minIntervalMs: number
  private accountId: string | undefined
  private lastTradeTimeLegacy = new Map<string, number>()

  constructor(options: Record<string, unknown>, accountId?: string) {
    this.minIntervalMs = Number(options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS)
    this.accountId = accountId
  }

  check(ctx: GuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null
    const symbol = getOperationSymbol(ctx.operation)

    if (!riskEngineEnabled() || !this.accountId) {
      const now = Date.now()
      const lastTime = this.lastTradeTimeLegacy.get(symbol)
      if (lastTime != null) {
        const elapsed = now - lastTime
        if (elapsed < this.minIntervalMs) {
          const remaining = Math.ceil((this.minIntervalMs - elapsed) / 1000)
          return `Cooldown active for ${symbol}: ${remaining}s remaining`
        }
      }
      this.lastTradeTimeLegacy.set(symbol, now)
      return null
    }

    // Flag on: R13 (RiskEngine, runs before this guard) already enforces
    // the cooldown from the same persistent state. Don't duplicate it here.
    return null
  }

  async recordSuccess(ctx: GuardContext): Promise<void> {
    if (!riskEngineEnabled() || !this.accountId) return
    if (ctx.operation.action !== 'placeOrder') return
    if (this.minIntervalMs <= 0) return
    const symbol = getOperationSymbol(ctx.operation)
    const now = new Date()
    const state = await loadRiskState(this.accountId, currentDayKey(now))
    const until = new Date(now.getTime() + this.minIntervalMs).toISOString()
    await saveRiskState(this.accountId, { ...state, cooldownUntil: { ...state.cooldownUntil, [symbol]: until } })
  }
}
