import { describe, expect, it, vi } from 'vitest'
import { createUTAClient } from './UTAClient.js'

describe('createUTAClient — Fase 4b bearer token (M8, ADR-0003)', () => {
  it('sends Authorization: Bearer <token> on every request when configured', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer alice-token-123')
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = createUTAClient({ baseUrl: 'http://127.0.0.1:47333', token: 'alice-token-123', fetch: fetchImpl as unknown as typeof fetch })
    await client.get('/uta')
    await client.post('/uta/x/wallet/commit', { message: 'm' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('omits Authorization entirely when no token is configured (compatibility mode)', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('authorization')).toBe(false)
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = createUTAClient({ baseUrl: 'http://127.0.0.1:47333', fetch: fetchImpl as unknown as typeof fetch })
    await client.get('/uta')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
