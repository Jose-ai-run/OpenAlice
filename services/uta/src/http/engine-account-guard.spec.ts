import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { utaAuthMiddleware } from './auth.js'
import { engineAccountGuard } from './engine-account-guard.js'

const STAGE_ONLY_TOKEN = 's'.repeat(43)  // e.g. operator-cli-style: stage but no engine
const ENGINE_TOKEN = 'e'.repeat(43)      // read + stage + engine (ADR-0003 shape)
const APPROVE_TOKEN = 'a'.repeat(43)     // Alice's token: read + stage + approve, never engine

const TOKENS_FILE = JSON.stringify({
  version: 1,
  tokens: [
    { token: STAGE_ONLY_TOKEN, scopes: ['read', 'stage'], label: 'operator-cli' },
    { token: ENGINE_TOKEN, scopes: ['read', 'stage', 'engine'], label: 'engine-service' },
    { token: APPROVE_TOKEN, scopes: ['read', 'stage', 'approve'], label: 'alice' },
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

async function setup(policy: unknown): Promise<{ tokensPath: string }> {
  tempDir = await mkdtemp(join(tmpdir(), 'engine-account-guard-'))
  const tokensPath = join(tempDir, 'uta-tokens.json')
  await writeFile(tokensPath, TOKENS_FILE)
  const policyPath = join(tempDir, 'risk-policy.json')
  await writeFile(policyPath, JSON.stringify(policy))
  process.env['OPENALICE_RISK_POLICY_PATH'] = policyPath
  return { tokensPath }
}

function makeApp(tokensPath: string | undefined): Hono {
  const app = new Hono()
  app.use('*', utaAuthMiddleware(tokensPath))
  app.use('*', engineAccountGuard())
  app.all('*', (c) => c.json({ ok: true }))
  return app
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

describe('engineAccountGuard', () => {
  it('compatibility mode (no tokens file) — no-ops entirely, no utaAuth to check', async () => {
    const app = makeApp(undefined)
    const res = await app.request('/api/trading/uta/any-account/wallet/stage-place-order', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('account not marked engineOwned — a stage-only token (no engine scope) still works, unaffected', async () => {
    const { tokensPath } = await setup({
      version: 1,
      accounts: { 'plain-account': { requireStopLoss: false } },
    })
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/plain-account/wallet/stage-place-order', {
      method: 'POST', headers: bearer(STAGE_ONLY_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('engineOwned account rejects a stage-scoped token that lacks the engine scope specifically', async () => {
    const { tokensPath } = await setup({
      version: 1,
      accounts: { 'engine-account': { requireStopLoss: false, engineOwned: true } },
    })
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/engine-account/wallet/stage-place-order', {
      method: 'POST', headers: bearer(STAGE_ONLY_TOKEN),
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'ENGINE_ACCOUNT_REQUIRES_ENGINE_SCOPE' })
  })

  it('engineOwned account allows a token that DOES carry the engine scope', async () => {
    const { tokensPath } = await setup({
      version: 1,
      accounts: { 'engine-account': { requireStopLoss: false, engineOwned: true } },
    })
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/engine-account/wallet/stage-place-order', {
      method: 'POST', headers: bearer(ENGINE_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('engineOwned account still allows commit only from an engine-scoped token too', async () => {
    const { tokensPath } = await setup({
      version: 1,
      accounts: { 'engine-account': { requireStopLoss: false, engineOwned: true } },
    })
    const app = makeApp(tokensPath)
    const denied = await app.request('/api/trading/uta/engine-account/wallet/commit', {
      method: 'POST', headers: bearer(STAGE_ONLY_TOKEN),
    })
    expect(denied.status).toBe(403)
    const allowed = await app.request('/api/trading/uta/engine-account/wallet/commit', {
      method: 'POST', headers: bearer(ENGINE_TOKEN),
    })
    expect(allowed.status).toBe(200)
  })

  it('does not gate non-stage routes on an engineOwned account (e.g. reads) — only stage/commit', async () => {
    const { tokensPath } = await setup({
      version: 1,
      accounts: { 'engine-account': { requireStopLoss: false, engineOwned: true } },
    })
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/engine-account/positions', {
      headers: bearer(STAGE_ONLY_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('an engineOwned account rejects staging with Alice\'s own token shape (read+stage+approve, never engine)', async () => {
    const { tokensPath } = await setup({
      version: 1,
      accounts: { 'engine-account': { requireStopLoss: false, engineOwned: true } },
    })
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/engine-account/wallet/stage-place-order', {
      method: 'POST', headers: bearer(APPROVE_TOKEN),
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'ENGINE_ACCOUNT_REQUIRES_ENGINE_SCOPE' })
  })

  it('push is never gated by this guard — a human\'s approve-scoped token (Alice, never engine) can still push on an engineOwned account', async () => {
    const { tokensPath } = await setup({
      version: 1,
      accounts: { 'engine-account': { requireStopLoss: false, engineOwned: true } },
    })
    const app = makeApp(tokensPath)
    // No pending commit exists in this fake app (routes are stubbed), so
    // this only proves the GUARD itself doesn't 403 an approve-scoped
    // caller on push — the actual "nothing to push" 400 from the real
    // route handler is a separate, pre-existing concern.
    const res = await app.request('/api/trading/uta/engine-account/wallet/push', {
      method: 'POST', headers: bearer(APPROVE_TOKEN),
    })
    expect(res.status).toBe(200)
  })

  it('falls back to "default" account policy the same way the RiskEngine does', async () => {
    const { tokensPath } = await setup({
      version: 1,
      accounts: { default: { requireStopLoss: false, engineOwned: true } },
    })
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/unlisted-account/wallet/stage-place-order', {
      method: 'POST', headers: bearer(STAGE_ONLY_TOKEN),
    })
    expect(res.status).toBe(403)
  })

  it('no risk policy configured at all — no-ops (RiskEngine\'s own gates handle that separately)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'engine-account-guard-nopolicy-'))
    const tokensPath = join(tempDir, 'uta-tokens.json')
    await writeFile(tokensPath, TOKENS_FILE)
    process.env['OPENALICE_RISK_POLICY_PATH'] = join(tmpdir(), 'definitely-does-not-exist.json')
    const app = makeApp(tokensPath)
    const res = await app.request('/api/trading/uta/any-account/wallet/stage-place-order', {
      method: 'POST', headers: bearer(STAGE_ONLY_TOKEN),
    })
    expect(res.status).toBe(200)
  })
})
