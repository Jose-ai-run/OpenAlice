import { describe, expect, it, vi } from 'vitest'
import { EngineLeaseClient, LeaseHeldError } from './engine-lease-client.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('EngineLeaseClient.acquireOrRenew', () => {
  it('returns epoch/expiresAt on success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ epoch: 42, expiresAt: '2026-09-25T12:00:30.000Z' })) as unknown as typeof fetch
    const client = new EngineLeaseClient({ utaBaseUrl: 'http://127.0.0.1:47333', accountId: 'engine-paper', instanceId: 'engine-1', fetchImpl })

    const lease = await client.acquireOrRenew(30)
    expect(lease).toEqual({ epoch: 42, expiresAt: '2026-09-25T12:00:30.000Z' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:47333/api/trading/risk/engine-lease',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ accountId: 'engine-paper', instanceId: 'engine-1', ttlSec: 30 }) }),
    )
  })

  it('throws LeaseHeldError with the holder identity on a real 409', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'LEASE_HELD', holder: { instanceId: 'engine-0', expiresAt: '2026-09-25T12:00:00.000Z' } }, 409)) as unknown as typeof fetch
    const client = new EngineLeaseClient({ utaBaseUrl: 'http://127.0.0.1:47333', accountId: 'engine-paper', instanceId: 'engine-1', fetchImpl })

    await expect(client.acquireOrRenew(30)).rejects.toThrow(LeaseHeldError)
    try {
      await client.acquireOrRenew(30)
    } catch (err) {
      expect((err as LeaseHeldError).holder?.instanceId).toBe('engine-0')
    }
  })
})

describe('EngineLeaseClient.reconcileBeforeFirstWrite (Enmienda 3)', () => {
  it('does nothing when there is no pending commit', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (url.toString().endsWith('/wallet/status')) return jsonResponse({ pendingHash: null })
      throw new Error(`unexpected call: ${url}`)
    }) as unknown as typeof fetch
    const client = new EngineLeaseClient({ utaBaseUrl: 'http://127.0.0.1:47333', accountId: 'engine-paper', instanceId: 'engine-1', fetchImpl })

    const result = await client.reconcileBeforeFirstWrite()
    expect(result).toEqual({ reconciled: true })
  })

  it('rejects an inherited pending commit, never pushes it, and tags the reason as a lease-transfer reconciliation', async () => {
    let rejectBody: unknown
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      if (u.endsWith('/wallet/status')) return jsonResponse({ pendingHash: 'abc123' })
      if (u.endsWith('/wallet/reject')) {
        rejectBody = JSON.parse(String(init?.body))
        return jsonResponse({ hash: 'abc123', message: '[rejected] ...', operationCount: 1 })
      }
      throw new Error(`test should never call ${u} — only status then reject`)
    }) as unknown as typeof fetch
    const client = new EngineLeaseClient({ utaBaseUrl: 'http://127.0.0.1:47333', accountId: 'engine-paper', instanceId: 'engine-2', fetchImpl })

    const result = await client.reconcileBeforeFirstWrite()
    expect(result).toEqual({ reconciled: true, rejectedPendingHash: 'abc123' })
    expect(rejectBody).toMatchObject({ expectedPendingHash: 'abc123', reason: expect.stringContaining('lease transfer reconciliation') })
  })
})

describe('EngineLeaseClient.release', () => {
  it('sends release:true for this instanceId', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ released: true })) as unknown as typeof fetch
    const client = new EngineLeaseClient({ utaBaseUrl: 'http://127.0.0.1:47333', accountId: 'engine-paper', instanceId: 'engine-1', fetchImpl })
    await client.release()
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ accountId: 'engine-paper', instanceId: 'engine-1', ttlSec: 1, release: true }) }),
    )
  })
})
