/**
 * [PROPUESTA] Persistent risk state — Fase 4a.
 *
 * Written atomically (tmp + rename) — deliberately NOT the pattern
 * git-persistence.ts uses (direct writeFile, confirmed non-atomic in
 * Fase 0). This file is the kill switch's durability boundary
 * ("kill switch persistente tras reinicio"); a torn write here is exactly
 * the failure mode Fase 0 flagged as a defect elsewhere, not one to repeat.
 *
 * Path: data/trading/_risk/risk-state.json, per PROMPT_MASTER_CLAUDE_CODE.md §14.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataPath } from '@/core/paths.js'

export type KillSwitchStatus = 'NORMAL' | 'HALT_NEW' | 'FLATTEN'

export interface RiskState {
  killSwitch: KillSwitchStatus
  killSwitchReason?: string
  killSwitchSetAt?: string
  /** ISO date (YYYY-MM-DD, policy timezone) the daily counters below were last reset for. */
  dayKey: string
  tradesToday: number
  tradesTodayBySymbol: Record<string, number>
  cooldownUntil: Record<string, string>
  consecutiveRejects: number
  dailyStartEquity?: string
  highWaterMarkEquity?: string
}

export function initialRiskState(dayKey: string): RiskState {
  return {
    killSwitch: 'NORMAL',
    dayKey,
    tradesToday: 0,
    tradesTodayBySymbol: {},
    cooldownUntil: {},
    consecutiveRejects: 0,
  }
}

function riskStatePath(accountId: string): string {
  return dataPath('trading', accountId, '_risk', 'risk-state.json')
}

function resetForNewDay(parsed: RiskState, dayKey: string): RiskState {
  // New calendar day: reset daily counters, but never silently clear an
  // active kill switch — a kill switch surviving a day boundary is
  // exactly the "persists after restart" contract; only an explicit
  // operator reset clears it (kill-switch.ts).
  return { ...parsed, dayKey, tradesToday: 0, tradesTodayBySymbol: {}, consecutiveRejects: 0, dailyStartEquity: undefined }
}

/**
 * Lenient loader: a MISSING file (first-ever run) is not an error and
 * returns a fresh initial state. Used by kill-switch.ts and cooldown.ts,
 * where a missing file is the common/expected case and the caller is
 * about to WRITE a new value anyway. For the primary risk-evaluation gate
 * (risk-engine.ts), use loadRiskStateStrict below instead — silently
 * treating a CORRUPT (not missing) file as "fresh NORMAL state" there
 * would mask an existing HALT_NEW/FLATTEN kill switch, which is the
 * opposite of fail-closed.
 */
export async function loadRiskState(accountId: string, dayKey: string): Promise<RiskState> {
  try {
    const raw = await readFile(riskStatePath(accountId), 'utf-8')
    const parsed = JSON.parse(raw) as RiskState
    return parsed.dayKey !== dayKey ? resetForNewDay(parsed, dayKey) : parsed
  } catch {
    return initialRiskState(dayKey)
  }
}

export type RiskStateLoadResult =
  | { ok: true; state: RiskState }
  | { ok: false; reason: string }

/**
 * Strict loader for the primary risk-evaluation gate: a MISSING file is
 * still fine (first-ever run -> fresh state), but a file that exists and
 * fails to parse is reported as `ok: false` instead of silently defaulting
 * — PROMPT_MASTER_CLAUDE_CODE.md §37 F4: "estado corrupto -> HALT_NEW".
 */
export async function loadRiskStateStrict(accountId: string, dayKey: string): Promise<RiskStateLoadResult> {
  let raw: string
  try {
    raw = await readFile(riskStatePath(accountId), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, state: initialRiskState(dayKey) }
    return { ok: false, reason: `cannot read risk state: ${err instanceof Error ? err.message : String(err)}` }
  }
  let parsed: RiskState
  try {
    parsed = JSON.parse(raw) as RiskState
  } catch (err) {
    return { ok: false, reason: `risk state is corrupt (invalid JSON): ${err instanceof Error ? err.message : String(err)}` }
  }
  if (typeof parsed.killSwitch !== 'string' || typeof parsed.dayKey !== 'string') {
    return { ok: false, reason: 'risk state is corrupt (missing required fields)' }
  }
  return { ok: true, state: parsed.dayKey !== dayKey ? resetForNewDay(parsed, dayKey) : parsed }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function saveRiskState(accountId: string, state: RiskState): Promise<void> {
  const filePath = riskStatePath(accountId)
  await mkdir(dirname(filePath), { recursive: true })
  // randomUUID, not just pid+timestamp — two saves in the same process
  // within the same millisecond (a real race under Promise.all) would
  // otherwise collide on the same tmp path.
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
  await writeFile(tmpPath, JSON.stringify(state, null, 2))

  // Windows-specific finding (Fase 4a): unlike POSIX rename(2), Windows can
  // transiently refuse a rename onto an existing destination with EPERM
  // when another handle briefly touches that path — observed here under
  // concurrent saves to the same account's risk-state.json (real usage is
  // one evaluateRisk() at a time per account, since TradingGit only ever
  // has one pending commit per account, but this function must not assume
  // that — it's a public, reusable persistence primitive). Retry a few
  // times with a short backoff rather than surfacing a spurious failure
  // for what is, from the caller's perspective, a successful save that
  // just needs the filesystem a few more milliseconds to settle.
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(tmpPath, filePath)
      return
    } catch (err) {
      lastError = err
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY') throw err
      await delay(10 * (attempt + 1))
    }
  }
  throw lastError
}

/** UTC calendar day key — policy timezone handling is a later-fase refinement (PROMPT_MASTER's policy.timezone field is accepted today but not yet applied to daily-counter resets). */
export function currentDayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}
