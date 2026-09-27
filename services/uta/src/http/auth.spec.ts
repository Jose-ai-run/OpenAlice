import { describe, expect, it, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { requiredScope, utaAuthMiddleware } from './auth.js'

const READ_TOKEN = 'r'.repeat(43)
const STAGE_TOKEN = 's'.repeat(43)
const APPROVE_TOKEN = 'a'.repeat(43)
const OPERATOR_TOKEN = 'o'.repeat(43)
const SIMULATOR_TOKEN = 'i'.repeat(43)

const VALID_TOKENS_FILE = JSON.stringify({
  version: 1,
  tokens: [
    { token: READ_TOKEN, scopes: ['read'], label: 'reader' },
    { token: STAGE_TOKEN, scopes: ['read', 'stage'], label: 'stager' },
    { token: APPROVE_TOKEN, scopes: ['read', 'stage', 'approve'], label: 'approver' },
    { token: OPERATOR_TOKEN, scopes: ['read', 'operator'], label: 'operator-cli' },
    { token: SIMULATOR_TOKEN, scopes: ['simulator'], label: 'sim' },
  ],
})

let tempDir: string | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

/** Writes a fresh tokens file and returns its path — the caller passes
 *  this into `makeApp()` exactly as `main.ts` passes the boot-time-
 *  resolved path into `utaAuthMiddleware()`. Nothing here touches
 *  `process.env` — the middleware no longer reads it per request
 *  (Fase 4b corrección A.1). */
async function writeTokensFile(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'uta-auth-spec-'))
  const path = join(tempDir, 'uta-tokens.json')
  await writeFile(path, VALID_TOKENS_FILE)
  return path
}

function makeApp(tokensPath: string | undefined): Hono {
  const app = new Hono()
  app.use('*', utaAuthMiddleware(tokensPath))
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

describe('utaAuthMiddleware — compatibility mode (no tokens path at boot)', () => {
  it('passes every request through unauthenticated', async () => {
    const app = makeApp(undefined)
    const res = await app.request('/api/trading/uta/x/wallet/push', { method: 'POST' })
    expect(res.status).toBe(200)
  })
})

describe('utaAuthMiddleware — enforced mode', () => {
  it('401s a write route with no Authorization header at all', async () => {
    const app = makeApp(await writeTokensFile())
    const res = await app.request('/api/trading/uta/x/wallet/push', { method: 'POST' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'NO_TOKEN' })
  })

  it('401s an unrecognized token', async () => {
    const app = makeApp(await writeTokensFile())
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST',
      headers: bearer('z'.repeat(43)),
    })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'INVALID_TOKEN' })
  })

  it('403s a recognized token missing the required scope, for every write route', async () => {
    const app = makeApp(await writeTokensFile())
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
    const app = makeApp(await writeTokensFile())
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
    const app = makeApp(await writeTokensFile())
    const res = await app.request('/api/trading/uta/x/wallet/push', {
      method: 'POST', headers: bearer(APPROVE_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('allows a read-scoped token through a read-only POST route (Engine historical bars)', async () => {
    const app = makeApp(await writeTokensFile())
    const res = await app.request('/api/trading/uta/x/historical', {
      method: 'POST', headers: bearer(READ_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('rejects a read-scoped token on /api/simulator/* (needs the simulator scope specifically)', async () => {
    const app = makeApp(await writeTokensFile())
    const res = await app.request('/api/simulator/uta/x/mark-price', {
      method: 'POST', headers: bearer(READ_TOKEN),
    })
    expect(res.status).toBe(403)
  })

  it('allows the simulator-scoped token through /api/simulator/* but not through trading reads', async () => {
    const app = makeApp(await writeTokensFile())
    const simRes = await app.request('/api/simulator/uta/x/mark-price', {
      method: 'POST', headers: bearer(SIMULATOR_TOKEN),
    })
    expect(simRes.status).toBe(200)
    const readRes = await app.request('/api/trading/uta/x/positions', { headers: bearer(SIMULATOR_TOKEN) })
    expect(readRes.status).toBe(403)
  })

  it('fails closed (503) when the tokens path was configured at boot but the file does not exist', async () => {
    const app = makeApp(join(tmpdir(), 'definitely-does-not-exist-uta-tokens.json'))
    const res = await app.request('/api/trading/uta/x/positions', { headers: bearer(READ_TOKEN) })
    expect(res.status).toBe(503)
  })
})

describe('utaAuthMiddleware — Fase 4b corrección A.1: never falls back to compatibility mode', () => {
  it('a valid token works, then deleting the file mid-run denies everything (401/503), never a silent pass-through', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const path = await writeTokensFile()
    const app = makeApp(path)

    const before = await app.request('/api/trading/uta/x/positions', { headers: bearer(READ_TOKEN) })
    expect(before.status).toBe(200)

    await unlink(path)

    // With a valid token: the file read fails, so this must be denied
    // (503) — it must NOT be treated as "no tokens file configured"
    // (which would silently pass through in compatibility mode).
    const afterWithToken = await app.request('/api/trading/uta/x/positions', { headers: bearer(READ_TOKEN) })
    expect(afterWithToken.status).toBe(503)
    // With no token at all: still must not be 200 (a pass-through would
    // be the compatibility-mode bug this test exists to catch).
    const afterNoToken = await app.request('/api/trading/uta/x/positions')
    expect(afterNoToken.status).not.toBe(200)
    expect(consoleError).toHaveBeenCalled()
  })

  it('a corrupted file (truncated JSON) denies everything, then restoring valid content recovers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const path = await writeTokensFile()
    const app = makeApp(path)

    const before = await app.request('/api/trading/uta/x/positions', { headers: bearer(READ_TOKEN) })
    expect(before.status).toBe(200)

    await writeFile(path, '{"version": 1, "tokens": [')  // simulates a partial/mid-write read
    const corrupted = await app.request('/api/trading/uta/x/positions', { headers: bearer(READ_TOKEN) })
    expect(corrupted.status).toBe(503)
    expect(consoleError).toHaveBeenCalled()

    await writeFile(path, VALID_TOKENS_FILE)
    const restored = await app.request('/api/trading/uta/x/positions', { headers: bearer(READ_TOKEN) })
    expect(restored.status).toBe(200)
  })

  it('an empty file (zero bytes) denies everything — not valid JSON, not "no auth configured"', async () => {
    const path = await writeTokensFile()
    const app = makeApp(path)
    await writeFile(path, '')
    const res = await app.request('/api/trading/uta/x/positions', { headers: bearer(READ_TOKEN) })
    expect(res.status).toBe(503)
  })
})
