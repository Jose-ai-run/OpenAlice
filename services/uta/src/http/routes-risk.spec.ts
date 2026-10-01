/**
 * Risk routes spec — exercises the HTTP adapter against the real
 * kill-switch module (services/uta/src/domain/trading/risk/kill-switch.ts),
 * not stubs, so a route-layer bug and a kill-switch-logic bug would both
 * show up here. vitest.setup.ts pins a per-worker OPENALICE_HOME, so each
 * test uses a unique accountId to avoid risk-state.json collisions.
 */
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createRiskRoutes } from './routes-risk.js'
import type { UTAEngineContext } from '../types.js'

function uniqueAccountId(): string {
  return `risk-routes-test-${randomUUID()}`
}

function makeCtx(accountIds: string[]): UTAEngineContext {
  const utas = new Map(accountIds.map((id) => [id, { id, label: id }]))
  return { utaManager: { get: (id: string) => utas.get(id) } } as unknown as UTAEngineContext
}

async function req(routes: ReturnType<typeof createRiskRoutes>, method: 'GET' | 'POST', path: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await routes.request(path, init)
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('GET /uta/:id/kill-switch', () => {
  it('404s for an unknown account', async () => {
    const routes = createRiskRoutes(makeCtx([]))
    const { status } = await req(routes, 'GET', '/uta/unknown/kill-switch')
    expect(status).toBe(404)
  })

  it('reports NORMAL for an account that never had a kill switch triggered', async () => {
    const id = uniqueAccountId()
    const routes = createRiskRoutes(makeCtx([id]))
    const { status, body } = await req(routes, 'GET', `/uta/${id}/kill-switch`)
    expect(status).toBe(200)
    expect(body).toEqual({ accountId: id, status: 'NORMAL' })
  })
})

describe('POST /uta/:id/kill-switch', () => {
  it('validates the body', async () => {
    const id = uniqueAccountId()
    const routes = createRiskRoutes(makeCtx([id]))
    const { status } = await req(routes, 'POST', `/uta/${id}/kill-switch`, { status: 'NOT_A_STATUS', reason: 'x' })
    expect(status).toBe(400)
  })

  it('triggers HALT_NEW and a subsequent GET reflects it — real persistence round-trip', async () => {
    const id = uniqueAccountId()
    const routes = createRiskRoutes(makeCtx([id]))

    const triggered = await req(routes, 'POST', `/uta/${id}/kill-switch`, { status: 'HALT_NEW', reason: 'canary test' })
    expect(triggered.status).toBe(200)
    expect(triggered.body).toEqual({ accountId: id, status: 'HALT_NEW', reason: 'canary test' })

    const read = await req(routes, 'GET', `/uta/${id}/kill-switch`)
    expect(read.body).toEqual({ accountId: id, status: 'HALT_NEW' })
  })
})

describe('POST /uta/:id/kill-switch/reset', () => {
  it('rejects clearing a same-day R16 daily-loss halt without force', async () => {
    const id = uniqueAccountId()
    const routes = createRiskRoutes(makeCtx([id]))
    await req(routes, 'POST', `/uta/${id}/kill-switch`, { status: 'HALT_NEW', reason: 'R16: daily loss' })

    const { status, body } = await req(routes, 'POST', `/uta/${id}/kill-switch/reset`, { reason: 'operator override attempt' })
    expect(status).toBe(409)
    expect(body).toMatchObject({ accountId: id, rejected: true })
  })

  it('resets to NORMAL with force', async () => {
    const id = uniqueAccountId()
    const routes = createRiskRoutes(makeCtx([id]))
    await req(routes, 'POST', `/uta/${id}/kill-switch`, { status: 'HALT_NEW', reason: 'R16: daily loss' })

    const { status, body } = await req(routes, 'POST', `/uta/${id}/kill-switch/reset`, { reason: 'operator confirmed', force: true })
    expect(status).toBe(200)
    expect(body).toEqual({ accountId: id, status: 'NORMAL', reason: 'operator confirmed' })
  })
})
