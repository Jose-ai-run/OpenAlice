import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEngineConfig, engineConfigSchema } from './engine-config.js'

describe('engine-config', () => {
  it('loads the real example config (verified real aliceIds — see docs/trading-engine/AUDIT.md)', () => {
    const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, 'engine-config.example.json'), 'utf-8'))
    const config = loadEngineConfig(raw)
    expect(config.mode).toBe('SIGNAL_ONLY')
    expect(config.interval).toBe('1h')
    expect(config.universe).toHaveLength(2)
    expect(config.universe.map((u) => u.aliceId)).toEqual([
      'bybit-readonly|BTC/USDT:USDT',
      'bybit-readonly|ETH/USDT:USDT',
    ])
  })

  it('rejects an empty universe', () => {
    expect(() => loadEngineConfig({ mode: 'SIGNAL_ONLY', interval: '1h', strategy: { id: 'x' }, universe: [] }))
      .toThrow()
  })

  it('rejects an aliceId without the required "<utaId>|<symbol>" shape', () => {
    const result = engineConfigSchema.safeParse({
      mode: 'SIGNAL_ONLY', interval: '1h', strategy: { id: 'x' },
      universe: [{ label: 'bad', utaId: 'bybit-readonly', aliceId: 'BTC-USDT-no-pipe' }],
    })
    expect(result.success).toBe(false)
  })

  it('requires paperAccountId when mode is PAPER', () => {
    const result = engineConfigSchema.safeParse({
      mode: 'PAPER', interval: '1h', strategy: { id: 'x' },
      universe: [{ label: 'BTC', utaId: 'bybit-readonly', aliceId: 'bybit-readonly|BTC/USDT:USDT' }],
    })
    expect(result.success).toBe(false)
  })

  it('does not require paperAccountId in SIGNAL_ONLY mode', () => {
    const result = engineConfigSchema.safeParse({
      mode: 'SIGNAL_ONLY', interval: '1h', strategy: { id: 'x' },
      universe: [{ label: 'BTC', utaId: 'bybit-readonly', aliceId: 'bybit-readonly|BTC/USDT:USDT' }],
    })
    expect(result.success).toBe(true)
  })
})
