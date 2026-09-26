import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { loadRiskState, saveRiskState, initialRiskState, currentDayKey } from './risk-state.js'

// Unique accountId per test — vitest.setup.ts pins one shared OPENALICE_HOME
// per worker, so risk-state.json paths must not collide across tests.
function uniqueAccountId(): string {
  return `risk-state-test-${randomUUID()}`
}

describe('risk-state', () => {
  it('loadRiskState returns a fresh initial state when nothing was ever saved', async () => {
    const accountId = uniqueAccountId()
    const state = await loadRiskState(accountId, '2026-09-25')
    expect(state).toEqual(initialRiskState('2026-09-25'))
  })

  it('round-trips a saved state exactly', async () => {
    const accountId = uniqueAccountId()
    const dayKey = '2026-09-25'
    const state = {
      ...initialRiskState(dayKey),
      killSwitch: 'HALT_NEW' as const,
      killSwitchReason: 'R16: daily loss',
      tradesToday: 3,
      tradesTodayBySymbol: { AAPL: 2, TSLA: 1 },
      consecutiveRejects: 2,
    }
    await saveRiskState(accountId, state)
    const loaded = await loadRiskState(accountId, dayKey)
    expect(loaded).toEqual(state)
  })

  it('persists the kill switch across a fresh load (simulating a UTA restart)', async () => {
    const accountId = uniqueAccountId()
    const dayKey = currentDayKey(new Date())
    await saveRiskState(accountId, { ...initialRiskState(dayKey), killSwitch: 'FLATTEN', killSwitchReason: 'operator confirmed' })

    // A brand-new load call, with no shared in-memory reference to the
    // previous one — this is the only way loadRiskState can know the
    // state, so a passing test here is direct evidence the kill switch
    // survives a process restart, not just an in-memory object surviving.
    const reloaded = await loadRiskState(accountId, dayKey)
    expect(reloaded.killSwitch).toBe('FLATTEN')
    expect(reloaded.killSwitchReason).toBe('operator confirmed')
  })

  it('resets daily counters but preserves the kill switch on a new day', async () => {
    const accountId = uniqueAccountId()
    await saveRiskState(accountId, {
      ...initialRiskState('2026-09-24'),
      killSwitch: 'HALT_NEW',
      killSwitchReason: 'R16: daily loss',
      tradesToday: 5,
      tradesTodayBySymbol: { AAPL: 5 },
      consecutiveRejects: 3,
      dailyStartEquity: '100000',
    })
    const nextDay = await loadRiskState(accountId, '2026-09-25')
    expect(nextDay.tradesToday).toBe(0)
    expect(nextDay.tradesTodayBySymbol).toEqual({})
    expect(nextDay.consecutiveRejects).toBe(0)
    expect(nextDay.dailyStartEquity).toBeUndefined()
    // The kill switch is NOT a daily counter — it never auto-clears on a day boundary.
    expect(nextDay.killSwitch).toBe('HALT_NEW')
    expect(nextDay.killSwitchReason).toBe('R16: daily loss')
  })

  it('never leaves a torn file: concurrent saves each fully land (atomic tmp+rename)', async () => {
    const accountId = uniqueAccountId()
    const dayKey = '2026-09-25'
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        saveRiskState(accountId, { ...initialRiskState(dayKey), tradesToday: i }),
      ),
    )
    // Whichever write landed last, the file must be valid JSON with a
    // valid RiskState shape — never a half-written fragment from an
    // interleaved non-atomic write.
    const finalState = await loadRiskState(accountId, dayKey)
    expect(typeof finalState.tradesToday).toBe('number')
    expect(finalState.tradesToday).toBeGreaterThanOrEqual(0)
    expect(finalState.tradesToday).toBeLessThan(10)
  })
})
