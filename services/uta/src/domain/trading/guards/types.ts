import type { Operation } from '../git/types.js'
import type { Position, AccountInfo } from '../brokers/types.js'

/** Read-only context assembled by the pipeline, consumed by guards. */
export interface GuardContext {
  readonly operation: Operation
  readonly positions: readonly Position[]
  readonly account: Readonly<AccountInfo>
}

/** A guard that can reject operations. Returns null to allow, or a rejection reason string. */
export interface OperationGuard {
  readonly name: string
  check(ctx: GuardContext): Promise<string | null> | string | null
  /**
   * [PROPUESTA] Fase 4a M3 — called after a successful dispatch (the
   * dispatcher resolved without throwing), so a guard can record state it
   * only wants to commit once the operation actually went through, instead
   * of when its own `check()` merely didn't reject. Optional: guards that
   * don't implement it are completely unaffected — this is additive.
   */
  recordSuccess?(ctx: GuardContext): void | Promise<void>
}

/** Registry entry: type identifier + factory function. */
export interface GuardRegistryEntry {
  type: string
  /** `accountId` is optional and new in Fase 4a — existing factories that ignore it are unaffected. */
  create(options: Record<string, unknown>, accountId?: string): OperationGuard
}
