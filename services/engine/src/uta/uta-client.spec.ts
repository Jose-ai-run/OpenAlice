import { describe, expect, it, vi } from 'vitest'
import { EngineUtaClient } from './uta-client.js'

describe('EngineUtaClient.getHistoricalBars', () => {
  it('posts to /api/trading/uta/:id/historical with the contract and params', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:47333/api/trading/uta/bybit-readonly/historical')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        contract: { aliceId: 'bybit-BTCUSDT' },
        params: { interval: '1h', limit: 2 },
      })
      return new Response(JSON.stringify({
        bars: [
          { timestamp: '2026-01-01T00:00:00.000Z', open: '1', high: '2', low: '0.5', close: '1.5', volume: '10' },
          { timestamp: '2026-01-01T01:00:00.000Z', open: '1.5', high: '2.5', low: '1', close: '2', volume: '20' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const client = new EngineUtaClient({ baseUrl: 'http://127.0.0.1:47333', fetchImpl: fetchImpl as unknown as typeof fetch })
    const bars = await client.getHistoricalBars({
      utaId: 'bybit-readonly',
      contract: { aliceId: 'bybit-BTCUSDT' },
      params: { interval: '1h', limit: 2 },
    })

    expect(bars).toHaveLength(2)
    expect(bars[0]!.timestamp).toBeInstanceOf(Date)
    expect(bars[0]!.timestamp.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(bars[1]!.close).toBe('2')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('sends Authorization: Bearer when a token is configured', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer engine-secret-token')
      return new Response(JSON.stringify({ bars: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = new EngineUtaClient({
      baseUrl: 'http://127.0.0.1:47333',
      token: 'engine-secret-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.getHistoricalBars({ utaId: 'bybit-readonly', contract: { aliceId: 'bybit-BTCUSDT' }, params: { interval: '1h' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('omits Authorization entirely when no token is configured (compatibility mode)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect('authorization' in (init?.headers as Record<string, string>)).toBe(false)
      return new Response(JSON.stringify({ bars: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = new EngineUtaClient({ baseUrl: 'http://127.0.0.1:47333', fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.getHistoricalBars({ utaId: 'bybit-readonly', contract: { aliceId: 'bybit-BTCUSDT' }, params: { interval: '1h' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('throws with the response body on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('Account not found', { status: 404 }))
    const client = new EngineUtaClient({ baseUrl: 'http://127.0.0.1:47333', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.getHistoricalBars({
      utaId: 'missing',
      contract: { aliceId: 'x' },
      params: { interval: '1d' },
    })).rejects.toThrow('404')
  })
})
