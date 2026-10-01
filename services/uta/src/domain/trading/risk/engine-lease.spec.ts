/**
 * engine-lease spec — exercises ADR-0009's exact acceptance plan.
 * vitest.setup.ts pins a per-worker OPENALICE_HOME; each test uses a
 * unique accountId to avoid colliding on the same engine-lease.json path.
 */
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { acquireOrRenewLease, releaseLease, checkLeaseFencing, getLeaseStatus } from './engine-lease.js'

function uniqueAccountId(): string {
  return `engine-lease-test-${randomUUID()}`
}

describe('acquireOrRenewLease', () => {
  it('grants a fresh lease with no prior state', async () => {
    const accountId = uniqueAccountId()
    const now = new Date('2026-09-25T12:00:00.000Z')
    const result = await acquireOrRenewLease(accountId, 'engine-1', 30, now)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.epoch).toBeGreaterThan(0)
      expect(result.expiresAt).toBe('2026-09-25T12:00:30.000Z')
    }
  })

  it('a second instance does NOT get the lease while the first holds it, and receives the holder identity (409 at the route layer)', async () => {
    const accountId = uniqueAccountId()
    const now = new Date('2026-09-25T12:00:00.000Z')
    await acquireOrRenewLease(accountId, 'engine-1', 30, now)

    const result = await acquireOrRenewLease(accountId, 'engine-2', 30, now)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.holder.instanceId).toBe('engine-1')
  })

  it('the SAME instance renews without changing the epoch', async () => {
    const accountId = uniqueAccountId()
    const t0 = new Date('2026-09-25T12:00:00.000Z')
    const first = await acquireOrRenewLease(accountId, 'engine-1', 30, t0)
    expect(first.ok).toBe(true)

    const t1 = new Date('2026-09-25T12:00:05.000Z')
    const second = await acquireOrRenewLease(accountId, 'engine-1', 30, t1)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.epoch).toBe(first.epoch)
      expect(second.expiresAt).toBe('2026-09-25T12:00:35.000Z')
    }
  })

  it('after the TTL expires, a second instance takes the lease with a strictly greater epoch, and the first is now fenced out', async () => {
    const accountId = uniqueAccountId()
    const t0 = new Date('2026-09-25T12:00:00.000Z')
    const first = await acquireOrRenewLease(accountId, 'engine-1', 10, t0)
    expect(first.ok).toBe(true)

    const tExpired = new Date('2026-09-25T12:00:11.000Z')  // 11s later, TTL was 10s
    const second = await acquireOrRenewLease(accountId, 'engine-2', 10, tExpired)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.epoch).toBeGreaterThan(first.epoch)

      // The first instance's old epoch is now rejected by fencing.
      const fencing = await checkLeaseFencing(accountId, first.epoch, tExpired)
      expect(fencing.ok).toBe(false)
    }
  })

  it('zombi after total state loss: epoch is still strictly greater than before (Enmienda 1 — time-based, not reset to 1)', async () => {
    const accountId = uniqueAccountId()
    const t0 = new Date('2026-09-25T12:00:00.000Z')
    const first = await acquireOrRenewLease(accountId, 'engine-1', 10, t0)
    expect(first.ok).toBe(true)

    // Simulate total loss of engine-lease.json by acquiring for a BRAND
    // NEW accountId (no file at all) at a LATER real time — the resulting
    // epoch (now.getTime()-based) must still exceed the lost epoch, which
    // is exactly what a zombi holding the old epoch in memory would fail
    // to replay.
    const later = new Date('2026-09-25T12:05:00.000Z')
    const afterLoss = await acquireOrRenewLease(uniqueAccountId(), 'engine-1', 10, later)
    expect(afterLoss.ok).toBe(true)
    if (first.ok && afterLoss.ok) {
      expect(afterLoss.epoch).toBeGreaterThan(first.epoch)
    }
  })
})

describe('checkLeaseFencing', () => {
  it('rejects with NO_LEASE when no lease was ever granted', async () => {
    const result = await checkLeaseFencing(uniqueAccountId(), 1, new Date())
    expect(result).toMatchObject({ ok: false, code: 'NO_LEASE' })
  })

  it('accepts the current holder presenting the matching epoch', async () => {
    const accountId = uniqueAccountId()
    const now = new Date('2026-09-25T12:00:00.000Z')
    const granted = await acquireOrRenewLease(accountId, 'engine-1', 30, now)
    expect(granted.ok).toBe(true)
    if (granted.ok) {
      const fencing = await checkLeaseFencing(accountId, granted.epoch, now)
      expect(fencing.ok).toBe(true)
    }
  })

  it('rejects a stale epoch with EPOCH_MISMATCH and reports the current epoch', async () => {
    const accountId = uniqueAccountId()
    const now = new Date('2026-09-25T12:00:00.000Z')
    const granted = await acquireOrRenewLease(accountId, 'engine-1', 30, now)
    expect(granted.ok).toBe(true)
    if (granted.ok) {
      const fencing = await checkLeaseFencing(accountId, granted.epoch - 1, now)
      expect(fencing).toMatchObject({ ok: false, code: 'EPOCH_MISMATCH', currentEpoch: granted.epoch })
    }
  })
})

describe('releaseLease', () => {
  it('the current holder releases immediately, freeing the lease for a new grant without waiting for the TTL', async () => {
    const accountId = uniqueAccountId()
    const t0 = new Date('2026-09-25T12:00:00.000Z')
    await acquireOrRenewLease(accountId, 'engine-1', 3600, t0)  // long TTL — would not expire naturally for this test

    const releaseResult = await releaseLease(accountId, 'engine-1', t0)
    expect(releaseResult.ok).toBe(true)

    const second = await acquireOrRenewLease(accountId, 'engine-2', 30, t0)
    expect(second.ok).toBe(true)
  })

  it('release does not change the epoch — monotonicity holds regardless of when a lease is released', async () => {
    const accountId = uniqueAccountId()
    const t0 = new Date('2026-09-25T12:00:00.000Z')
    const granted = await acquireOrRenewLease(accountId, 'engine-1', 3600, t0)
    expect(granted.ok).toBe(true)
    await releaseLease(accountId, 'engine-1', t0)

    const second = await acquireOrRenewLease(accountId, 'engine-2', 30, t0)
    expect(second.ok).toBe(true)
    if (granted.ok && second.ok) expect(second.epoch).toBeGreaterThan(granted.epoch)
  })

  it('rejects releasing a lease held by a different instance', async () => {
    const accountId = uniqueAccountId()
    const t0 = new Date('2026-09-25T12:00:00.000Z')
    await acquireOrRenewLease(accountId, 'engine-1', 30, t0)
    const result = await releaseLease(accountId, 'engine-2', t0)
    expect(result.ok).toBe(false)
  })

  it('releasing when nothing was ever granted is a no-op, not an error', async () => {
    const result = await releaseLease(uniqueAccountId(), 'engine-1', new Date())
    expect(result.ok).toBe(true)
  })
})

describe('getLeaseStatus', () => {
  it('reports undefined for an account with no lease', async () => {
    expect(await getLeaseStatus(uniqueAccountId())).toBeUndefined()
  })
  it('reports the real persisted lease', async () => {
    const accountId = uniqueAccountId()
    await acquireOrRenewLease(accountId, 'engine-1', 30, new Date('2026-09-25T12:00:00.000Z'))
    const status = await getLeaseStatus(accountId)
    expect(status?.instanceId).toBe('engine-1')
  })
})
