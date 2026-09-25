import { describe, expect, it } from 'vitest'
import { createApp } from './main.js'

describe('engine health route (Fase 1 skeleton)', () => {
  it('GET /engine/health responds ok with a startedAt timestamp', async () => {
    const startedAt = new Date().toISOString()
    const app = createApp(startedAt)

    const res = await app.request('/engine/health')

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; startedAt: string }
    expect(body.ok).toBe(true)
    expect(body.startedAt).toBe(startedAt)
  })

  it('does not answer unrelated paths', async () => {
    const app = createApp(new Date().toISOString())
    const res = await app.request('/engine/status')
    expect(res.status).toBe(404)
  })
})
