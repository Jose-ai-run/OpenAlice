/**
 * [PROPUESTA] UTA bearer-token auth — Fase 4b, ADR-0003.
 *
 * Scopes are fixed by PROMPT_MASTER_CLAUDE_CODE.md §26 and ADR-0003; a
 * token can carry several (composition, not hierarchy — `operator` does
 * not imply `simulator`, for instance, so least-privilege stays explicit
 * per token).
 */
import { z } from 'zod'

export const UTA_SCOPES = ['read', 'stage', 'approve', 'engine', 'operator', 'simulator'] as const
export type UtaScope = (typeof UTA_SCOPES)[number]

export const utaTokenEntrySchema = z.object({
  /** Random ≥32 bytes, base64url — the bearer secret itself. */
  token: z.string().min(32),
  scopes: z.array(z.enum(UTA_SCOPES)).min(1),
  label: z.string().min(1),
})
export type UtaTokenEntry = z.infer<typeof utaTokenEntrySchema>

export const utaTokensFileSchema = z.object({
  version: z.literal(1),
  tokens: z.array(utaTokenEntrySchema),
})
export type UtaTokensFile = z.infer<typeof utaTokensFileSchema>
