import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findToken, loadUtaTokens } from './tokens-file.js'
import type { UtaTokenEntry } from './types.js'

const VALID_TOKEN_A = 'a'.repeat(43)  // ≥32 chars, matches base64url token length in practice
const VALID_TOKEN_B = 'b'.repeat(43)

async function withFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'uta-tokens-file-'))
  const path = join(dir, 'uta-tokens.json')
  await writeFile(path, content)
  try {
    await fn(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('loadUtaTokens', () => {
  it('loads a well-formed tokens file', async () => {
    await withFile(JSON.stringify({
      version: 1,
      tokens: [{ token: VALID_TOKEN_A, scopes: ['read', 'stage', 'approve'], label: 'alice' }],
    }), async (path) => {
      const result = await loadUtaTokens(path)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.tokens).toHaveLength(1)
        expect(result.tokens[0]!.label).toBe('alice')
      }
    })
  })

  it('fails closed (does not throw) when the file does not exist', async () => {
    const result = await loadUtaTokens(join(tmpdir(), 'does-not-exist-uta-tokens.json'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/cannot read/)
  })

  it('fails closed on invalid JSON', async () => {
    await withFile('{not json', async (path) => {
      const result = await loadUtaTokens(path)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/not valid JSON/)
    })
  })

  it('fails closed on a schema violation (unknown scope)', async () => {
    await withFile(JSON.stringify({
      version: 1,
      tokens: [{ token: VALID_TOKEN_A, scopes: ['not-a-real-scope'], label: 'x' }],
    }), async (path) => {
      const result = await loadUtaTokens(path)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/schema validation/)
    })
  })

  it('fails closed on a token shorter than 32 characters', async () => {
    await withFile(JSON.stringify({
      version: 1,
      tokens: [{ token: 'too-short', scopes: ['read'], label: 'x' }],
    }), async (path) => {
      const result = await loadUtaTokens(path)
      expect(result.ok).toBe(false)
    })
  })
})

describe('findToken', () => {
  const entries: UtaTokenEntry[] = [
    { token: VALID_TOKEN_A, scopes: ['read'], label: 'alice' },
    { token: VALID_TOKEN_B, scopes: ['read', 'engine'], label: 'engine-service' },
  ]

  it('matches the correct entry by exact token', () => {
    expect(findToken(entries, VALID_TOKEN_B)?.label).toBe('engine-service')
  })

  it('returns undefined for an unrecognized token', () => {
    expect(findToken(entries, 'c'.repeat(43))).toBeUndefined()
  })

  it('returns undefined for a token of different length (no crash from timingSafeEqual)', () => {
    expect(findToken(entries, 'short')).toBeUndefined()
  })

  it('returns undefined against an empty token list', () => {
    expect(findToken([], VALID_TOKEN_A)).toBeUndefined()
  })
})
