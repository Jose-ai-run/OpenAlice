import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { utaAuthMiddleware } from './auth.js'
import { engineFencing } from './engine-fencing.js'
import { acquireOrRenewLease } from '../domain/trading/risk/engine-lease.js'

const STAGE_ONLY_TOKEN = 's'.repeat(43)  // no engine scope
const ENGINE_TOKEN = 'e'.repeat(43)      // read + stage + engine (ADR-0003 shape)

const TOKENS_FILE = JSON.stringify({
  version: 1,
  tokens: [
    { token: STAGE_ONLY_TOKEN, scopes: ['read', 'stage'], label: 'operator-cli' },
    { token: ENGINE_TOKEN, scopes: ['read', 'stage', 'engine'], label: 'engine-service' },
  ],
})

let tempDir: string | undefined
const originalEnv = { ...process.env }

afterEach(async () => {
  process.env = { ...originalEnv }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

async function setup(): Promise<{ tokensPath: string }> {
  tempDir = await mkdtemp(join(tmpdir(), 'engine-fencing-'))
  const tokensPath = join(tempDir, 'uta-tokens.json')
  await writeFile(tokensPath, TOKENS_FILE)
  return { tokensPath }
}

function makeApp(tokensPath: string | undefined, now: () => Date = () => new Date()): Hono {
  const app = new Hono()
  app.use('*', utaAuthMiddleware(tokensPath))
  app.use('*', engineFencing(now))
  app.all('*', (c) => c.json({ ok: true }))
  return app
}

function bearer(token: string, epoch?: number): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` }
  if (epoch !== undefined) headers['x-engine-epoch'] = String(epoch)
  return headers
}

function uniqueAccountId(): string {
  return `engine-fencing-test-${randomUUID()}`
}

describe('engineFencing', () => {
  it('compatibility mode (no tokens file) — no-ops entirely', async () => {
    const app = makeApp(undefined)
    const res = await app.request('/api/trading/uta/any-account/wallet/stage-place-order', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('a non-engine-scoped token is never fenced, even with no X-Engine-Epoch header', async () => {
    const { tokensPath } = await setup()
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/some-account/wallet/stage-place-order', {
      method: 'POST', headers: bearer(STAGE_ONLY_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('an engine-scoped token with NO X-Engine-Epoch header gets 401 (same code family as "no token")', async () => {
    const { tokensPath } = await setup()
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/some-account/wallet/stage-place-order', {
      method: 'POST', headers: bearer(ENGINE_TOKEN),
    })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'NO_ENGINE_EPOCH' })
  })

  it('an engine-scoped token with no lease granted yet gets 409 NO_LEASE', async () => {
    const { tokensPath } = await setup()
    const app = makeApp(tokensPath)
    const res = await app.request(`/api/trading/uta/${uniqueAccountId()}/wallet/stage-place-order`, {
      method: 'POST', headers: bearer(ENGINE_TOKEN, 1),
    })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'NO_LEASE' })
  })

  it('presenting the real current epoch after acquiring a lease passes through', async () => {
    const { tokensPath } = await setup()
    const accountId = uniqueAccountId()
    const granted = await acquireOrRenewLease(accountId, 'engine-1', 30, new Date())
    expect(granted.ok).toBe(true)
    const app = makeApp(tokensPath)
    const res = await app.request(`/api/trading/uta/${accountId}/wallet/stage-place-order`, {
      method: 'POST', headers: bearer(ENGINE_TOKEN, granted.ok ? granted.epoch : -1),
    })
    expect(res.status).toBe(200)
  })

  it('presenting a stale epoch (a zombi instance) gets 409 EPOCH_MISMATCH with the current epoch', async () => {
    const { tokensPath } = await setup()
    const accountId = uniqueAccountId()
    const t0 = new Date('2026-09-25T12:00:00.000Z')
    const first = await acquireOrRenewLease(accountId, 'engine-1', 10, t0)
    expect(first.ok).toBe(true)
    // engine-2 takes over after expiry.
    const t1 = new Date('2026-09-25T12:00:11.000Z')
    await acquireOrRenewLease(accountId, 'engine-2', 10, t1)

    const app = makeApp(tokensPath, () => t1)
    const res = await app.request(`/api/trading/uta/${accountId}/wallet/stage-place-order`, {
      method: 'POST', headers: bearer(ENGINE_TOKEN, first.ok ? first.epoch : -1),
    })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'EPOCH_MISMATCH' })
  })
})
