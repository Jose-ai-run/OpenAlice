/**
 * [PROPUESTA] Kill switch state machine — Fase 4a.
 * NORMAL | HALT_NEW | FLATTEN, persisted via risk-state.ts (atomic).
 *
 * Reset requiring `operator` scope + a reason (PROMPT_MASTER_CLAUDE_CODE.md
 * §34) is an auth concern — Fase 4b (M7/M8) wires the actual scope check at
 * the HTTP route. This module exposes the state transition itself; nothing
 * here enforces WHO may call it — that enforcement is Fase 4b's job.
 */
import { loadRiskState, saveRiskState, currentDayKey, type KillSwitchStatus, type RiskState } from './risk-state.js'

export async function getKillSwitchStatus(accountId: string, now: Date): Promise<KillSwitchStatus> {
  const state = await loadRiskState(accountId, currentDayKey(now))
  return state.killSwitch
}

export async function triggerKillSwitch(
  accountId: string,
  status: 'HALT_NEW' | 'FLATTEN',
  reason: string,
  now: Date,
): Promise<RiskState> {
  const state = await loadRiskState(accountId, currentDayKey(now))
  // Never downgrade automatically: FLATTEN is stricter than HALT_NEW: a
  // rule that fires HALT_NEW must not silently loosen an existing FLATTEN.
  const next: KillSwitchStatus = state.killSwitch === 'FLATTEN' ? 'FLATTEN' : status
  const updated: RiskState = { ...state, killSwitch: next, killSwitchReason: reason, killSwitchSetAt: now.toISOString() }
  await saveRiskState(accountId, updated)
  return updated
}

/** Explicit operator reset — see the module docstring re: auth. `force` is required to clear a same-day daily-loss halt (PROMPT_MASTER_CLAUDE_CODE.md §34). */
export async function resetKillSwitch(
  accountId: string,
  reason: string,
  now: Date,
  options: { force?: boolean } = {},
): Promise<RiskState | { rejected: true; reason: string }> {
  const state = await loadRiskState(accountId, currentDayKey(now))
  if (state.killSwitchReason?.startsWith('R16:') && !options.force) {
    return { rejected: true, reason: 'a daily-loss halt (R16) cannot be reset before the next day without force' }
  }
  const updated: RiskState = { ...state, killSwitch: 'NORMAL', killSwitchReason: reason, killSwitchSetAt: now.toISOString() }
  await saveRiskState(accountId, updated)
  return updated
}
