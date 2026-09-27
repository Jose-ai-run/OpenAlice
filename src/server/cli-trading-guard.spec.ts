import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { ToolCenter } from '../core/tool-center.js'
import { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import { registerCliRoutes, type CliGatewayDeps } from './cli.js'
import { createTradingTools } from '../tool/trading.js'
import { UTAManagerSDK } from '../services/uta-client/UTAManagerSDK.js'
import { createUTAClient } from '@traderalice/uta-protocol'

/**
 * [PROPUESTA] Fase 4d item 0 — /cli is unauthenticated by design (the
 * normal surface for a Workspace agent's own shell), but it inherits
 * Alice's own service identity for trading — the exact same
 * `UTAManagerSDK`/token every other in-process caller (Telegram,
 * `tradingPush`) uses. It carries no `engine` scope, ever.
 *
 * This test exercises the REAL /cli dispatch chain end to end
 * (`registerCliRoutes`, tool-name resolution, Zod arg validation,
 * `wrapToolExecute`, the real `createTradingTools` staging logic) —
 * the only simulated piece is UTA's actual HTTP response, standing in
 * for a real UTA process. What that response WOULD be — a 403 from
 * `engine-account-guard.ts` for exactly this token shape — is verified
 * independently, for real, against the real UTA middleware chain, in
 * `services/uta/src/http/engine-account-guard.spec.ts` (see its
 * "Alice's own token shape" case). Combined, the two tests prove the
 * full path without importing UTA's internals into Alice's own test
 * suite (the two are separate deployable processes — see
 * docs/project-structure.md — and this keeps that boundary real in
 * tests too, not just in production).
 */

const ENGINE_ACCOUNT_ID = 'engine-paper'

function fakeUtaFetch(opts: { pendingMessage?: string; pendingHash?: string }): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString()
    const method = (init?.method ?? 'GET').toUpperCase()

    if (u.endsWith('/api/trading/uta') && method === 'GET') {
      return new Response(JSON.stringify({
        utas: [{ id: ENGINE_ACCOUNT_ID, label: 'Engine paper', asVendor: false, capabilities: {}, health: { status: 'healthy' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('/wallet/status') && method === 'GET') {
      return new Response(JSON.stringify({
        staged: [],
        pendingMessage: opts.pendingMessage ?? null,
        pendingHash: opts.pendingHash ?? null,
        head: null,
        commitCount: 0,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('/wallet/stage-place-order') && method === 'POST') {
      // The real UTA response shape when engine-account-guard.ts rejects a
      // non-engine-scoped token on an engineOwned account — mirrored
      // exactly from services/uta/src/http/engine-account-guard.ts.
      return new Response(JSON.stringify({
        error: 'Forbidden',
        code: 'ENGINE_ACCOUNT_REQUIRES_ENGINE_SCOPE',
        detail: `account "${ENGINE_ACCOUNT_ID}" is Engine-managed — only a token with the "engine" scope may stage or commit on it`,
      }), { status: 403, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('/wallet/push') && method === 'POST') {
      throw new Error(`test should never reach push — tradingPush must stop at the allowAiTrading gate, got: ${u}`)
    }
    throw new Error(`unexpected fetch in test: ${method} ${u}`)
  }) as typeof fetch
}

function makeApp(manager: UTAManagerSDK, allowAiTrading: () => boolean): Hono {
  const toolCenter = new ToolCenter()
  toolCenter.register(createTradingTools(manager, allowAiTrading), 'trading')

  const deps: CliGatewayDeps = {
    toolCenter,
    workspaceToolCenter: new WorkspaceToolCenter(),
    inboxStore: {} as never,
    entityStore: {} as never,
    getWorkspaceService: () => ({
      registry: { get: (id: string) => (id === 'ws1' ? { id: 'ws1', tag: 'demo' } : undefined) },
    }) as never,
  }
  const app = new Hono()
  registerCliRoutes(app, deps)
  return app
}

function invoke(app: Hono, tool: string, args: unknown) {
  return app.request('/cli/ws1/uta/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, args }),
  })
}

describe('Fase 4d item 0 — /cli inherits Alice\'s token, never the engine scope', () => {
  it('via /cli, staging on an engine-owned account fails — the 403 from engine-account-guard propagates as an error result, not silent success', async () => {
    const client = createUTAClient({ baseUrl: 'http://fake-uta', fetch: fakeUtaFetch({}), token: 'alice-token-read-stage-approve-never-engine' })
    const manager = new UTAManagerSDK({ client })
    const app = makeApp(manager, () => true)

    const res = await invoke(app, 'placeOrder', {
      aliceId: `${ENGINE_ACCOUNT_ID}|BTC/USDT:USDT`,
      action: 'BUY',
      orderType: 'MKT',
      totalQuantity: '0.001',
    })

    // /cli turns a tool-level error into a flat 500 { error: string } — see
    // server/cli.ts's invoke handler ("if (result.isError) ... return
    // c.json({ error: text ... }, 500)"). Confirmed empirically (not
    // assumed): the underlying UTAHttpError message only carries UTA's
    // top-level `error` field ("Forbidden"), not `code`/`detail` — a minor
    // observability gap noted in docs/uta-auth.md, out of scope to fix
    // here. The security property this test exists to prove — staging
    // never silently succeeds — holds regardless of message richness.
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Error: Forbidden')
  })

  it('via /cli, tradingPush with allowAiTrading=false does NOT execute — it returns "requires manual approval", never calls push', async () => {
    const client = createUTAClient({
      baseUrl: 'http://fake-uta',
      fetch: fakeUtaFetch({ pendingMessage: 'Entry: test thesis', pendingHash: 'abc12345' }),
      token: 'alice-token-read-stage-approve-never-engine',
    })
    const manager = new UTAManagerSDK({ client })
    const app = makeApp(manager, () => false)  // agent.allowAiTrading = false

    const res = await invoke(app, 'tradingPush', { source: ENGINE_ACCOUNT_ID })

    expect(res.status).toBe(200)
    const body = await res.json() as { content: Array<{ type: string; text: string }>; isError?: boolean }
    expect(body.isError).toBeFalsy()  // this is not a tool ERROR — it's a normal "ask a human" result
    const text = body.content[0]?.text ?? ''
    expect(text).toContain('requires manual approval')
    expect(text).toContain('Web UI')
    // fakeUtaFetch throws if push is ever actually called — reaching here
    // (no thrown/unhandled rejection) is itself part of the proof.
  })

  it('via /cli, tradingPush with allowAiTrading=true (the opposite control) DOES execute — proving the gate is real, not a no-op', async () => {
    let pushCalled = false
    const fetchImpl: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = url.toString()
      const method = (init?.method ?? 'GET').toUpperCase()
      if (u.endsWith('/api/trading/uta') && method === 'GET') {
        return new Response(JSON.stringify({ utas: [{ id: ENGINE_ACCOUNT_ID, label: 'Engine paper', asVendor: false, capabilities: {}, health: { status: 'healthy' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (u.includes('/wallet/status') && method === 'GET') {
        return new Response(JSON.stringify({ staged: [], pendingMessage: 'Entry: test thesis', pendingHash: 'abc12345', head: null, commitCount: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (u.includes('/wallet/push') && method === 'POST') {
        pushCalled = true
        return new Response(JSON.stringify({ hash: 'abc12345', message: 'Entry: test thesis', operationCount: 1, submitted: [], rejected: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${method} ${u}`)
    }) as typeof fetch
    const client = createUTAClient({ baseUrl: 'http://fake-uta', fetch: fetchImpl, token: 'alice-token' })
    const manager = new UTAManagerSDK({ client })
    const app = makeApp(manager, () => true)

    const res = await invoke(app, 'tradingPush', { source: ENGINE_ACCOUNT_ID })
    expect(res.status).toBe(200)
    const body = await res.json() as { content: Array<{ type: string; text: string }>; isError?: boolean }
    expect(body.isError).toBeFalsy()
    expect(body.content[0]?.text).toContain('pushed')
    expect(pushCalled).toBe(true)
  })
})
