import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadRiskPolicy, resolveAccountPolicy, riskPolicySchema } from './policy.js'

const VALID_POLICY = {
  version: 1,
  accounts: {
    default: { requireStopLoss: true },
    'mock-paper': { requireStopLoss: false, maxOrderNotional: 5000 },
  },
}

async function withTempFile(content: string | null, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'risk-policy-test-'))
  const path = join(dir, 'risk-policy.json')
  if (content !== null) await writeFile(path, content)
  try {
    await fn(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('deploy/examples/risk-policy.example.json — CI schema validation (Fase 4c, ADR-0010)', () => {
  it('loads and validates cleanly through loadRiskPolicy, including the new R21 maxSpreadBps field', async () => {
    const examplePath = resolve(process.cwd(), 'deploy/examples/risk-policy.example.json')
    const result = await loadRiskPolicy(examplePath)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.policy.accounts['default']?.maxSpreadBps).toBe(50)
    }
  })
})

describe('loadRiskPolicy', () => {
  it('loads and hashes a valid policy', async () => {
    await withTempFile(JSON.stringify(VALID_POLICY), async (path) => {
      const result = await loadRiskPolicy(path)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.policy.version).toBe(1)
        expect(result.policyHash).toMatch(/^[0-9a-f]{16}$/)
      }
    })
  })

  it('fails closed (ok:false) when the file does not exist — never throws', async () => {
    const result = await loadRiskPolicy('/definitely/does/not/exist/risk-policy.json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('cannot read')
  })

  it('fails closed on invalid JSON', async () => {
    await withTempFile('{ not valid json', async (path) => {
      const result = await loadRiskPolicy(path)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('not valid JSON')
    })
  })

  it('fails closed on a schema violation (missing required "accounts")', async () => {
    await withTempFile(JSON.stringify({ version: 1 }), async (path) => {
      const result = await loadRiskPolicy(path)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain('schema validation')
    })
  })

  it('two loads of the identical content produce the same hash', async () => {
    await withTempFile(JSON.stringify(VALID_POLICY), async (path) => {
      const a = await loadRiskPolicy(path)
      const b = await loadRiskPolicy(path)
      expect(a.ok && b.ok && a.policyHash === b.policyHash).toBe(true)
    })
  })
})

describe('resolveAccountPolicy', () => {
  const policy = riskPolicySchema.parse(VALID_POLICY)

  it('resolves the exact account id when present', () => {
    const resolved = resolveAccountPolicy(policy, 'mock-paper')
    expect(resolved?.requireStopLoss).toBe(false)
    expect(resolved?.maxOrderNotional).toBe(5000)
  })

  it('falls back to "default" when the account id has no entry', () => {
    const resolved = resolveAccountPolicy(policy, 'unknown-account')
    expect(resolved?.requireStopLoss).toBe(true)
  })

  it('returns undefined when neither the account nor "default" exists', () => {
    const noDefault = riskPolicySchema.parse({ version: 1, accounts: { 'other-account': {} } })
    expect(resolveAccountPolicy(noDefault, 'unknown-account')).toBeUndefined()
  })
})
