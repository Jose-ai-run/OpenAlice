/**
 * [PROPUESTA] Risk status/control routes — PROMPT_MASTER_CLAUDE_CODE.md §7
 * ("services/uta/src/http/routes-risk.ts   # GET estado/política(hash)/
 * decisiones; POST kill-switch (operator)"). Minimal slice built for Hito 1
 * Parte 2's canary kill-switch test (AUDIT.md §18): GET/POST/reset
 * kill-switch only. Policy/decisions read endpoints stay
 * "NO ENCONTRADO EN EL REPOSITORIO" — future work, not needed for this gate.
 *
 * No entry was added to auth.ts's SCOPE_RULES: any route that table doesn't
 * match already falls back to the most privileged scope, `operator`
 * (auth.ts's own documented default) — exactly the scope PROMPT_MASTER §34
 * specifies for the kill switch ("se activa por endpoint con scope
 * operator"), with zero new auth code.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import type { UTAEngineContext } from '../types.js'
import { getKillSwitchStatus, triggerKillSwitch, resetKillSwitch } from '../domain/trading/risk/kill-switch.js'

const triggerSchema = z.object({
  status: z.enum(['HALT_NEW', 'FLATTEN']),
  reason: z.string().min(1),
})

const resetSchema = z.object({
  reason: z.string().min(1),
  force: z.boolean().optional(),
})

export function createRiskRoutes(ctx: UTAEngineContext) {
  const app = new Hono()

  app.get('/uta/:id/kill-switch', async (c) => {
    const id = c.req.param('id')
    if (!ctx.utaManager.get(id)) return c.json({ error: `UTA ${id} not found` }, 404)
    const status = await getKillSwitchStatus(id, new Date())
    return c.json({ accountId: id, status })
  })

  app.post('/uta/:id/kill-switch', async (c) => {
    const id = c.req.param('id')
    if (!ctx.utaManager.get(id)) return c.json({ error: `UTA ${id} not found` }, 404)
    const parsed = triggerSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400)
    const updated = await triggerKillSwitch(id, parsed.data.status, parsed.data.reason, new Date())
    return c.json({ accountId: id, status: updated.killSwitch, reason: updated.killSwitchReason })
  })

  app.post('/uta/:id/kill-switch/reset', async (c) => {
    const id = c.req.param('id')
    if (!ctx.utaManager.get(id)) return c.json({ error: `UTA ${id} not found` }, 404)
    const parsed = resetSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400)
    const result = await resetKillSwitch(id, parsed.data.reason, new Date(), { force: parsed.data.force })
    if ('rejected' in result) return c.json({ accountId: id, rejected: true, reason: result.reason }, 409)
    return c.json({ accountId: id, status: result.killSwitch, reason: result.killSwitchReason })
  })

  return app
}
