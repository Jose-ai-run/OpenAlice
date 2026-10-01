/**
 * ITradingGit — Trading-as-Git interface
 *
 * Git-style three-phase workflow for trading operations:
 *   add → commit → push → log / show / status
 */

import type Decimal from 'decimal.js'
import type { Contract, Order } from '@traderalice/ibkr'
import type {
  CommitHash,
  Operation,
  AddResult,
  CommitPrepareResult,
  PushResult,
  RejectResult,
  GitStatus,
  GitCommit,
  CommitLogEntry,
  GitExportState,
  GitState,
  PendingGitState,
  PriceChangeInput,
  SimulatePriceChangeResult,
  OrderStatusUpdate,
  SyncResult,
} from './types.js'

export interface ITradingGit {
  // ---- git add / commit / push ----

  add(operation: Operation): AddResult
  commit(message: string): CommitPrepareResult
  push(expectedPendingHash: string): Promise<PushResult>
  reject(reason: string | undefined, expectedPendingHash: string): Promise<RejectResult>

  // ---- wallet reconciliation (synthesized commits) ----

  recordReconcile(params: {
    aliceId: string
    quantityDelta: Decimal
    markPrice: Decimal
    stateAfter: GitState
    message?: string
  }): Promise<CommitHash>

  // ---- git log / show / status ----

  log(options?: { limit?: number; symbol?: string }): CommitLogEntry[]
  show(hash: CommitHash): GitCommit | null
  status(): GitStatus

  // ---- git pull (sync pending orders) ----

  sync(updates: OrderStatusUpdate[], currentState: GitState): Promise<SyncResult>
  /** `localSymbol` is the broker-native symbol from the order's operation
   *  contract — passed to IBroker.getOrder as the symbolHint so lookups
   *  survive restarts (CCXT's order API is symbol-scoped). */
  getPendingOrderIds(): Array<{ orderId: string; symbol: string; localSymbol?: string; aliceId?: string }>
  /** Squash externally-observed open orders into one [observed] commit. */
  recordObservedOrders(params: {
    observed: Array<{ contract: Contract; order: Order; orderId: string }>
    stateAfter: GitState
  }): Promise<CommitHash>
  /** Every broker orderId the log has ever seen. */
  getKnownOrderIds(): Set<string>

  // ---- serialization ----

  exportState(): GitExportState
  setCurrentRound(round: number): void

  // ---- simulation ----

  simulatePriceChange(priceChanges: PriceChangeInput[]): Promise<SimulatePriceChangeResult>
}

/**
 * [PROPUESTA] Fase 4c corrección item 4 (2026-09-27) — the commit hash and
 * within-commit position are both already known and fixed by the time
 * `executeOperation` runs (computed at `commit()`, before `push()` ever
 * calls it — see `TradingGit.executePush()`). Threading them through lets
 * the RiskEngine log an unambiguous correlation key
 * (`RiskDecisionLogEntry.pendingHash` + `operationIndex`) instead of the
 * independent-audit job (ADR-0010) having to fuzzy-match by timestamp.
 */
export interface OperationExecutionContext {
  commitHash: CommitHash
  operationIndex: number
  /**
   * [PROPUESTA] Hito 1 Parte 2 (AUDIT.md §19, item 1b) — every operation in
   * THIS commit, in order, so a risk rule (R14) can recognize a sibling
   * protective stop staged alongside its entry in the same commit. Always
   * the full batch, including `operation` itself at `operationIndex`.
   */
  allOperations: readonly Operation[]
}

export interface TradingGitConfig {
  executeOperation: (operation: Operation, ctx?: OperationExecutionContext) => Promise<unknown>
  getGitState: () => Promise<GitState>
  onCommit?: (state: GitExportState) => void | Promise<void>
  /**
   * [PROPUESTA] Hito 1 Parte 2, F7 (M5) — fired whenever the staged/pending
   * batch changes: after `add()` (staged, not yet committed), after
   * `commit()` (pending, awaiting push), and with `null` once `push()` or
   * `reject()` clears it. Independent of `onCommit` (which only fires on a
   * completed commit) so a crash between `commit()` and `push()` can be
   * recovered from `data/trading/<id>/pending.json` on restart.
   */
  onPendingChange?: (pending: PendingGitState | null) => void | Promise<void>
}
