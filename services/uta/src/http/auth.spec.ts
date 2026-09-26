import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { requiredScope, utaAuthMiddleware } from './auth.js'

const READ_TOKEN = 'r'.repeat(43)
const STAGE_TOKEN = 's'.repeat(43)
const APPROVE_TOKEN = 'a'.repeat(43)
const OPERATOR_TOKEN = 'o'.repeat(43)
const SIMULATOR_TOKEN = 'i'.repeat(43)

let tempDir: string | undefined

afterEach(async () => {
  delete process.env['OPENALICE_UTA_TOKENS_FILE']
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

async function configureTokensFile(): Promise<void> {
  tempDir = await mkdtemp(join(tmpdir(), 'uta-auth-spec-'))
  const path = join(tempDir, 'uta-tokens.json')
  await writeFile(path, JSON.stringify({
    version: 1,
    tokens: [
      { token: READ_TOKEN, scopes: ['read'], label: 'reader' },
      { token: STAGE_TOKEN, scopes: ['read', 'stage'], label: 'stager' },
      { token: APPROVE_TOKEN, scopes: ['read', 'stage', 'approve'], label: 'approver' },
      { token: OPERATOR_TOKEN, scopes: ['read', 'operator'], label: 'operator-cli' },
      { token: SIMULATOR_TOKEN, scopes: ['simulator'], label: 'sim' },
    ],
  }))
  process.env['OPENALICE_UTA_TOKENS_FILE'] = path
}

function makeApp(): Hono {
  const app = new Hono()
  app.use('*', utaAuthMiddleware())
  app.all('*', (c) => c.json({ ok: true }))
  return app
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

describe('requiredScope — route table', () => {
  it.each([
    ['GET', '/api/trading/uta/x/positions', 'read'],
    ['POST', '/api/trading/uta/x/historical', 'read'],
    ['POST', '/api/trading/uta/x/quote', 'read'],
    ['POST', '/api/trading/uta/x/contract/expand', 'read'],
    ['POST', '/api/trading/uta/x/wallet/stage-place-order', 'stage'],
    ['POST', '/api/trading/uta/x/wallet/commit', 'stage'],
    ['POST', '/api/trading/uta/x/wallet/reject', 'stage'],
    ['POST', '/api/trading/uta/x/wallet/push', 'approve'],
    ['POST', '/api/trading/uta/x/wallet/place-order', 'approve'],
    ['POST', '/api/trading/uta/x/wallet/close-position', 'approve'],
    ['POST', '/api/trading/uta/x/wallet/cancel-order', 'approve'],
    ['POST', '/api/trading/uta/x/reconnect', 'operator'],
    ['DELETE', '/api/trading/uta/x/snapshots/2026-01-01', 'operator'],
    ['POST', '/api/simulator/uta/x/mark-price', 'simulator'],
  ] as const)('%s %s -> %s', (method, path, scope) => {
    expect(requiredScope(method, path)).toBe(scope)
  })
})

describe('utaAuthMiddleware — compatibility mode (no tokens file configured)', () => {
  it('passes every request through unauthenticated', async () => {
    const app = makeApp()
    const res = await app.request('/api/trading/uta/x/wallet/push', { method: 'POST' })
    expect(res.status).toBe(200)
  })
})

describe('utaAuthMiddleware — enforced mode', () => {
  it('401s a write route with no Authorization header at all', async () => {
    await configureTokensFile()
    const app = makeApp()
    const res = await app.request('/api/trading/uta/x/wallet/push', { method: 'POST' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'NO_TOKEN' })
  })

  it('401s an unrecognized token', async () => {
    await configureTokensFile()
    const app = makeApp()
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST',
      headers: bearer('z'.repeat(43)),
    })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'INVALID_TOKEN' })
  })

  it('403s a recognized token missing the required scope, for every write route', async () => {
    await configureTokensFile()
    const app = makeApp()
    const writeRoutes: Array<[string, string]> = [
      ['POST', '/api/trading/uta/x/wallet/stage-place-order'],
      ['POST', '/api/trading/uta/x/wallet/push'],
      ['POST', '/api/trading/uta/x/wallet/place-order'],
      ['POST', '/api/trading/uta/x/reconnect'],
      ['POST', '/api/simulator/uta/x/mark-price'],
    ]
    for (const [method, path] of writeRoutes) {
      // READ_TOKEN carries only `read` — none of these routes accept it.
      const res = await app.request(path, { method, headers: bearer(READ_TOKEN) })
      expect(res.status, `${method} ${path}`).toBe(403)
      await expect(res.json()).resolves.toMatchObject({ code: 'INSUFFICIENT_SCOPE' })
    }
  })

  it('allows a stage-scoped token to stage but not to push', async () => {
    await configureTokensFile()
    const app = makeApp()
    const stageRes = await app.request('/api/trading/uta/x/wallet/stage-place-order', {
      method: 'POST', headers: bearer(STAGE_TOKEN),
    })
    expect(stageRes.status).toBe(200)
    const pushRes = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST', headers: bearer(STAGE_TOKEN),
    })
    expect(pushRes.status).toBe(403)
  })

  it('allows an approve-scoped token through push', async () => {
    await configureTokensFile()
    const app = makeApp()
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST', headers: bearer(APPROVE_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('allows a read-scoped token through a read-only POST route (Engine historical bars)', async () => {
    await configureTokensFile()
    const app = makeApp()
    const res = await app.request('/api/trading/uta/x/historical', {
      method: 'POST', headers: bearer(READ_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('rejects a read-scoped token on /api/simulator/* (needs the simulator scope specifically)', async () => {
    await configureTokensFile()
    const app = makeApp()
    const res = await app.request('/api/simulator/uta/x/mark-price', {
      method: 'POST', headers: bearer(READ_TOKEN),
    })
    expect(res.status).toBe(403)
  })

  it('allows the simulator-scoped token through /api/simulator/* but not through trading reads', async () => {
    await configureTokensFile()
    const app = makeApp()
    const simRes = await app.request('/api/simulator/uta/x/mark-price', {
      method: 'POST', headers: bearer(SIMULATOR_TOKEN),
    })
    expect(simRes.status).toBe(200)
    const readRes = await app.request('/api/trading/uta/x/positions', { headers: bearer(SIMULATOR_TOKEN) })
    expect(readRes.status).toBe(403)
  })

  it('fails closed (503) when the tokens file is configured but unreadable', async () => {
    process.env['OPENALICE_UTA_TOKENS_FILE'] = join(tmpdir(), 'definitely-does-not-exist-uta-tokens.json')
    const app = makeApp()
    const res = await app.request('/api/trading/uta/x/positions', { headers: bearer(READ_TOKEN) })
    expect(res.status).toBe(503)
  })
})
