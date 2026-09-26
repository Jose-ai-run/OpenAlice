import { describe, expect, it } from 'vitest'
import { checkUtaAuthDeploymentSafety, isLoopbackHost, resolveUtaBindHost } from './deployment-safety.js'

describe('resolveUtaBindHost', () => {
  it('defaults to 127.0.0.1 when unset', () => {
    expect(resolveUtaBindHost({})).toBe('127.0.0.1')
  })

  it('honors OPENALICE_UTA_BIND_HOST when set', () => {
    expect(resolveUtaBindHost({ OPENALICE_UTA_BIND_HOST: '0.0.0.0' })).toBe('0.0.0.0')
  })
})

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', 'localhost', '::1', '[::1]'])('treats %s as loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(true)
  })

  it.each(['0.0.0.0', '10.0.0.5', 'example.com'])('treats %s as non-loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })
})

describe('checkUtaAuthDeploymentSafety', () => {
  it('refuses to start on a non-loopback bind with no tokens file configured', () => {
    const result = checkUtaAuthDeploymentSafety({ OPENALICE_UTA_BIND_HOST: '0.0.0.0' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/non-loopback/)
  })

  it('starts on a non-loopback bind when a tokens file IS configured', () => {
    const result = checkUtaAuthDeploymentSafety({
      OPENALICE_UTA_BIND_HOST: '0.0.0.0',
      OPENALICE_UTA_TOKENS_FILE: '/etc/openalice/uta-tokens.json',
    })
    expect(result.ok).toBe(true)
    expect(result.warn).toBeUndefined()
  })

  it('warns (but starts) on loopback with no tokens file configured — compatibility mode', () => {
    const result = checkUtaAuthDeploymentSafety({})
    expect(result.ok).toBe(true)
    expect(result.warn).toMatch(/compatibility mode/)
  })

  it('starts clean (no warning) on loopback with a tokens file configured', () => {
    const result = checkUtaAuthDeploymentSafety({ OPENALICE_UTA_TOKENS_FILE: '/etc/openalice/uta-tokens.json' })
    expect(result.ok).toBe(true)
    expect(result.warn).toBeUndefined()
  })
})
