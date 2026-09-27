import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  checkTokensFileDevLocation,
  checkUtaAuthDeploymentSafety,
  isLoopbackHost,
  resolveUtaBindHost,
} from './deployment-safety.js'

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

describe('checkTokensFileDevLocation — Fase 4b corrección A.1', () => {
  const home = join('home', 'user', '.openalice')

  it('warns when the tokens file lives inside OPENALICE_HOME', () => {
    const warning = checkTokensFileDevLocation(join(home, 'uta-tokens.json'), home)
    expect(warning).toMatch(/inside OPENALICE_HOME/)
  })

  it('warns specifically about a Workspace (agent shell access) when nested that deep', () => {
    const warning = checkTokensFileDevLocation(join(home, 'workspaces', 'ws-1', 'uta-tokens.json'), home)
    expect(warning).toMatch(/inside a Workspace/)
  })

  it('does not warn when the tokens file lives outside OPENALICE_HOME entirely', () => {
    const warning = checkTokensFileDevLocation(join('etc', 'openalice', 'uta-tokens.json'), home)
    expect(warning).toBeUndefined()
  })

  it('is a pure path comparison — does not touch the filesystem (works for a path that does not exist)', () => {
    expect(() => checkTokensFileDevLocation(join('nonexistent', 'path', 'tokens.json'), home)).not.toThrow()
  })
})
