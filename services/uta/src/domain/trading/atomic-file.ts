/**
 * [PROPUESTA] Shared atomic-write primitive — Hito 1 Parte 2, F7 (AUDIT.md
 * §19, item 3, M4). Extracted from `risk/risk-state.ts` (Fase 4a), which
 * remains the literal precedent per ADR-0009's own instruction to reuse it,
 * not reinvent it — this file just gives that exact pattern a shared home
 * so `git-persistence.ts` (M4) and the engine-lease module (A6) use the
 * same tmp+rename+retry code instead of three copies of it.
 */
import { writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Write `content` to `filePath` atomically: write to a unique tmp path,
 * then rename onto the destination. A rename is atomic on POSIX; on
 * Windows it can transiently fail with EPERM/EBUSY while another handle
 * briefly touches the path (observed in Fase 4a under concurrent saves) —
 * retried a few times with a short backoff before giving up for real.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  // randomUUID, not just pid+timestamp — two saves in the same process
  // within the same millisecond (a real race under Promise.all) would
  // otherwise collide on the same tmp path.
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
  await writeFile(tmpPath, content)

  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(tmpPath, filePath)
      return
    } catch (err) {
      lastError = err
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY') throw err
      await delay(10 * (attempt + 1))
    }
  }
  throw lastError
}
