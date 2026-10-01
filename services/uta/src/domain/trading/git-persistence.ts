/**
 * Git state persistence — load/save Trading-as-Git commit history.
 *
 * Extracted from main.ts. Pure functions + file IO, no instance dependencies.
 */

import { readFile, unlink } from 'fs/promises'
import type { GitExportState, PendingGitState } from './git/types.js'
import { dataPath } from '@/core/paths.js'
import { atomicWriteFile } from './atomic-file.js'

// ==================== Paths ====================

function gitFilePath(accountId: string): string {
  return dataPath('trading', accountId, 'commit.json')
}

/** [PROPUESTA] Hito 1 Parte 2, F7 (M5) — PROMPT_MASTER_CLAUDE_CODE.md §5's exact path. */
function pendingFilePath(accountId: string): string {
  return dataPath('trading', accountId, 'pending.json')
}

/** Legacy paths for backward compat. TODO: remove before v1.0 */
const LEGACY_GIT_PATHS: Record<string, string> = {
  'bybit-main': dataPath('crypto-trading', 'commit.json'),
  'alpaca-paper': dataPath('securities-trading', 'commit.json'),
  'alpaca-live': dataPath('securities-trading', 'commit.json'),
}

// ==================== Public API ====================

/** Read saved git state from disk, trying primary path then legacy fallback. */
export async function loadGitState(accountId: string): Promise<GitExportState | undefined> {
  const primary = gitFilePath(accountId)
  try {
    return JSON.parse(await readFile(primary, 'utf-8')) as GitExportState
  } catch { /* try legacy */ }
  const legacy = LEGACY_GIT_PATHS[accountId]
  if (legacy) {
    try {
      return JSON.parse(await readFile(legacy, 'utf-8')) as GitExportState
    } catch { /* no saved state */ }
  }
  return undefined
}

/**
 * Create a callback that persists git state to disk on each commit.
 *
 * [PROPUESTA] Hito 1 Parte 2, F7 (AUDIT.md §19, item 3, M4) — atomic
 * tmp+rename write (via `atomic-file.ts`), replacing the direct
 * `writeFile` Fase 0 flagged as non-atomic (a crash mid-write used to be
 * able to leave `commit.json` truncated/corrupt).
 */
export function createGitPersister(accountId: string): (state: GitExportState) => Promise<void> {
  const filePath = gitFilePath(accountId)
  return async (state: GitExportState) => {
    await atomicWriteFile(filePath, JSON.stringify(state, null, 2))
  }
}

/**
 * [PROPUESTA] Hito 1 Parte 2, F7 (M5) — read a persisted staged/pending
 * batch, if any. Absent (ENOENT) ⇒ `undefined`, same convention as
 * `loadGitState`'s "no saved state" case.
 */
export async function loadPendingState(accountId: string): Promise<PendingGitState | undefined> {
  try {
    return JSON.parse(await readFile(pendingFilePath(accountId), 'utf-8')) as PendingGitState
  } catch {
    return undefined
  }
}

/**
 * Create a callback that persists (or, on `null`, deletes) the staged/pending
 * batch — wired to `TradingGitConfig.onPendingChange`. Deleting rather than
 * writing `null` keeps `loadPendingState`'s ENOENT-is-absent convention
 * consistent for the "no pending state" case after a push/reject.
 */
export function createPendingPersister(accountId: string): (pending: PendingGitState | null) => Promise<void> {
  const filePath = pendingFilePath(accountId)
  return async (pending: PendingGitState | null) => {
    if (pending === null) {
      await unlink(filePath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err
      })
      return
    }
    await atomicWriteFile(filePath, JSON.stringify(pending, null, 2))
  }
}
