/**
 * git-persistence spec — AUDIT.md §19, item 3 (M4/M5). vitest.setup.ts
 * pins a per-worker OPENALICE_HOME, so each test uses a unique accountId
 * to avoid colliding on the same commit.json/pending.json path.
 */
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { loadGitState, createGitPersister, loadPendingState, createPendingPersister } from './git-persistence.js'
import type { GitExportState, PendingGitState } from './git/types.js'

function uniqueAccountId(): string {
  return `git-persistence-test-${randomUUID()}`
}

describe('createGitPersister / loadGitState (M4 — atomic write)', () => {
  it('round-trips a commit.json write exactly', async () => {
    const accountId = uniqueAccountId()
    const state: GitExportState = { commits: [], head: 'abc123' }
    await createGitPersister(accountId)(state)
    expect(await loadGitState(accountId)).toEqual(state)
  })

  it('a missing commit.json loads as undefined', async () => {
    expect(await loadGitState(uniqueAccountId())).toBeUndefined()
  })
})

describe('createPendingPersister / loadPendingState (M5)', () => {
  it('round-trips a pending.json write exactly', async () => {
    const accountId = uniqueAccountId()
    const pending: PendingGitState = { stagingArea: [], pendingMessage: 'test commit', pendingHash: 'hash1' }
    await createPendingPersister(accountId)(pending)
    expect(await loadPendingState(accountId)).toEqual(pending)
  })

  it('a missing pending.json loads as undefined (the common case — nothing pending)', async () => {
    expect(await loadPendingState(uniqueAccountId())).toBeUndefined()
  })

  it('writing null deletes a previously persisted pending file', async () => {
    const accountId = uniqueAccountId()
    const persist = createPendingPersister(accountId)
    await persist({ stagingArea: [], pendingMessage: 'x', pendingHash: 'h' })
    expect(await loadPendingState(accountId)).toBeDefined()

    await persist(null)
    expect(await loadPendingState(accountId)).toBeUndefined()
  })

  it('writing null when no file exists yet does not throw (ENOENT is not an error here)', async () => {
    const accountId = uniqueAccountId()
    await expect(createPendingPersister(accountId)(null)).resolves.not.toThrow()
  })
})
