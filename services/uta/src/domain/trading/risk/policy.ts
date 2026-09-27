/**
 * [PROPUESTA] Risk policy schema + loader — Fase 4a, ADR-0004.
 *
 * The policy is a host-owned, read-only file. UTA never writes it
 * (PROMPT_MASTER_CLAUDE_CODE.md §14: "Ninguna API escribe la política.").
 * Production default path: /etc/openalice/risk-policy.json (mounted RO).
 * OPENALICE_RISK_POLICY_PATH overrides it — required in dev, since
 * /etc/openalice/ does not exist on a non-Linux dev machine (Fase 0 ran on
 * Windows; ADR-0004 anticipated exactly this).
 */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const accountRiskPolicySchema = z.object({
  allowedSymbols: z.array(z.string()).optional(),
  allowedSecTypes: z.array(z.string()).optional(),
  allowedActions: z.array(z.enum(['placeOrder', 'modifyOrder', 'closePosition', 'cancelOrder'])).optional(),
  /** 'always' for crypto-style 24/7 venues; 'marketHours' consults the broker's getMarketClock(). */
  tradingHours: z.enum(['always', 'marketHours']).default('always'),
  maxOrderNotional: z.number().positive().optional(),
  maxPositionNotional: z.number().positive().optional(),
  maxPositionPctEquity: z.number().positive().optional(),
  maxGrossExposurePctEquity: z.number().positive().optional(),
  maxNetExposurePctEquity: z.number().positive().optional(),
  maxLeverage: z.number().positive().optional(),
  maxOpenPositions: z.number().int().positive().optional(),
  maxTradesPerDay: z.number().int().positive().optional(),
  maxTradesPerSymbolPerDay: z.number().int().positive().optional(),
  cooldownSecondsPerSymbol: z.number().nonnegative().optional(),
  maxRiskPerTradePctEquity: z.number().positive().optional(),
  requireStopLoss: z.boolean().default(true),
  maxDailyLossPctEquity: z.number().positive().optional(),
  maxDrawdownPctFromHWM: z.number().positive().optional(),
  priceBandPct: z.number().positive().optional(),
  maxQuoteAgeSeconds: z.number().positive().default(30),
  maxConsecutiveRejects: z.number().int().positive().optional(),
  capitalCap: z.number().positive().optional(),
  /** [PROPUESTA] R21 (Fase 4c, A7a) — max bid/ask spread in basis points. Unset = rule disabled for this account. */
  maxSpreadBps: z.number().positive().optional(),
  /** [PROPUESTA] R21 corrección 2026-09-27 — explicit per-account opt-in
   *  to accept a broker whose bid/ask isn't real (e.g. Leverup, which
   *  sets bid=ask=last). Default false: a synthetic-looking quote
   *  (absent, bid===ask, or bid>ask) rejects by default, same as a
   *  missing quote — see rules/r21-max-spread.ts. */
  allowSyntheticQuotes: z.boolean().default(false),
  /** [PROPUESTA] Fase 4d (S1) — marks this account as Engine-managed.
   *  `http/engine-account-guard.ts` then requires the `engine` scope
   *  specifically (not just any `stage`-scoped token) to stage or commit
   *  on it — a human's `approve`-scoped push still works normally, and
   *  can only ever approve the pendingHash the Engine itself created
   *  (TradingGit allows only one pending commit at a time). Default
   *  false: an ordinary account is unaffected. */
  engineOwned: z.boolean().default(false),
})
export type AccountRiskPolicy = z.infer<typeof accountRiskPolicySchema>

export const riskPolicySchema = z.object({
  version: z.number().int().positive(),
  timezone: z.string().default('UTC'),
  /** Ceiling on the execution-mode calculation from ADR-0005 — Fase 4a does not consume this yet (no Engine caller exists), but the field is part of the policy contract from day one so a later fase does not need a schema migration. */
  executionModeMax: z.number().int().min(1).max(6).default(6),
  /** Keyed by UTA account id; 'default' is used when an id has no specific entry. */
  accounts: z.record(z.string(), accountRiskPolicySchema),
})
export type RiskPolicy = z.infer<typeof riskPolicySchema>

export type RiskPolicyLoadResult =
  | { ok: true; policy: RiskPolicy; policyHash: string }
  | { ok: false; reason: string }

export function resolveRiskPolicyPath(): string {
  return process.env['OPENALICE_RISK_POLICY_PATH']?.trim() || '/etc/openalice/risk-policy.json'
}

/**
 * Never throws — every failure mode (missing file, invalid JSON, schema
 * violation) resolves to `{ ok: false }` so callers can fail closed
 * explicitly (PROMPT_MASTER_CLAUDE_CODE.md §14: "política ausente o
 * inválida ... -> rechazar / HALT_NEW") rather than crash the process.
 */
export async function loadRiskPolicy(path: string = resolveRiskPolicyPath()): Promise<RiskPolicyLoadResult> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    return { ok: false, reason: `cannot read risk policy at ${path}: ${err instanceof Error ? err.message : String(err)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: `risk policy at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  const result = riskPolicySchema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, reason: `risk policy at ${path} failed schema validation: ${result.error.message}` }
  }
  const policyHash = createHash('sha256').update(JSON.stringify(result.data)).digest('hex').slice(0, 16)
  return { ok: true, policy: result.data, policyHash }
}

/** Per-account resolution: exact id, else 'default', else undefined (caller fails closed). */
export function resolveAccountPolicy(policy: RiskPolicy, accountId: string): AccountRiskPolicy | undefined {
  return policy.accounts[accountId] ?? policy.accounts['default']
}
