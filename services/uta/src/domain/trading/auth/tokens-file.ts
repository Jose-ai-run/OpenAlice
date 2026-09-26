/**
 * [PROPUESTA] UTA tokens-file loader — Fase 4b, ADR-0003.
 *
 * Same conventions as risk/policy.ts: host-owned, read-only, JSON, never
 * in git — `OPENALICE_UTA_TOKENS_FILE` overrides no default path here
 * (unlike the risk policy) because there is no sensible in-repo default
 * for a live secret file; unset means "not configured", which the
 * deployment-safety gate treats as compatibility mode on loopback.
 *
 * Deliberately re-read on every request rather than cached in memory:
 * `loadRiskPolicy` already established that precedent (no SIGHUP watcher
 * exists anywhere in this codebase) and it buys instant token revocation
 * by editing the file, at the cost of one small `readFile` per request —
 * negligible next to a broker round-trip.
 */
import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { utaTokensFileSchema, type UtaTokenEntry } from './types.js'

export type UtaTokensLoadResult =
  | { ok: true; tokens: UtaTokenEntry[] }
  | { ok: false; reason: string }

export function resolveUtaTokensFilePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env['OPENALICE_UTA_TOKENS_FILE']?.trim() || undefined
}

/** Never throws — every failure mode (missing file, invalid JSON, schema
 *  violation) resolves to `{ ok: false }` so the auth middleware can fail
 *  closed (503) instead of crashing the request. */
export async function loadUtaTokens(path: string): Promise<UtaTokensLoadResult> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    return { ok: false, reason: `cannot read UTA tokens file at ${path}: ${err instanceof Error ? err.message : String(err)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: `UTA tokens file at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  const result = utaTokensFileSchema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, reason: `UTA tokens file at ${path} failed schema validation: ${result.error.message}` }
  }
  return { ok: true, tokens: result.data.tokens }
}

/**
 * Constant-time match against every entry. A length mismatch short-
 * circuits before `timingSafeEqual` (which throws on unequal-length
 * buffers) — the same trade-off `src/services/auth/token-store.ts`
 * already accepts for the single-token admin case: only the candidate's
 * length is observable, never which stored token it was compared against.
 */
export function findToken(tokens: readonly UtaTokenEntry[], candidate: string): UtaTokenEntry | undefined {
  const candidateBuf = Buffer.from(candidate, 'utf-8')
  for (const entry of tokens) {
    const storedBuf = Buffer.from(entry.token, 'utf-8')
    if (storedBuf.length === candidateBuf.length && timingSafeEqual(storedBuf, candidateBuf)) {
      return entry
    }
  }
  return undefined
}
