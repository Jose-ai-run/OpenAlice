import { describe, expect, it, vi } from 'vitest'
import { PriceFeeder, nativeKeyOf, paperAliceId } from './price-feeder.js'

describe('nativeKeyOf / paperAliceId', () => {
  it('extracts the nativeKey after the first pipe', () => {
    expect(nativeKeyOf('bybit-readonly|BTC/USDT:USDT')).toBe('BTC/USDT:USDT')
  })
  it('rejects an aliceId with no pipe', () => {
    expect(() => nativeKeyOf('no-pipe-here')).toThrow(/invalid aliceId/)
  })
  it('builds the paper account aliceId reusing the same nativeKey', () => {
    expect(paperAliceId('engine-paper', 'bybit-readonly|BTC/USDT:USDT')).toBe('engine-paper|BTC/USDT:USDT')
  })
})

describe('PriceFeeder', () => {
  it('POSTs nativeKey + price to the simulator mark-price route', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ filled: ['order-1'] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    const feeder = new PriceFeeder({ utaBaseUrl: 'http://127.0.0.1:47333', fetchImpl })

    const result = await feeder.setMarkPrice('engine-paper', 'BTC/USDT:USDT', '85000.5')

    expect(result).toEqual({ filled: ['order-1'] })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:47333/api/simulator/uta/engine-paper/mark-price',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ nativeKey: 'BTC/USDT:USDT', price: '85000.5' }),
      }),
    )
  })

  it('throws with the response body on a non-2xx status', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 400 })) as unknown as typeof fetch
    const feeder = new PriceFeeder({ utaBaseUrl: 'http://127.0.0.1:47333', fetchImpl })

    await expect(feeder.setMarkPrice('engine-paper', 'BTC/USDT:USDT', '1')).rejects.toThrow(/failed: 400 boom/)
  })
})
