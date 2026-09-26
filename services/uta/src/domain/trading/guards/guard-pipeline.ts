/**
 * Guard Pipeline
 *
 * The only place that touches the account: assembles a GuardContext,
 * then passes it through the guard chain. Guards themselves never
 * see the account.
 */

import type { Operation } from '../git/types.js'
import type { IBroker } from '../brokers/types.js'
import type { OperationGuard, GuardContext } from './types.js'

export function createGuardPipeline(
  dispatcher: (op: Operation) => Promise<unknown>,
  account: IBroker,
  guards: OperationGuard[],
): (op: Operation) => Promise<unknown> {
  if (guards.length === 0) return dispatcher

  return async (op: Operation): Promise<unknown> => {
    const [positions, accountInfo] = await Promise.all([
      account.getPositions(),
      account.getAccount(),
    ])

    const ctx: GuardContext = { operation: op, positions, account: accountInfo }

    for (const guard of guards) {
      const rejection = await guard.check(ctx)
      if (rejection != null) {
        return { success: false, error: `[guard:${guard.name}] ${rejection}` }
      }
    }

    const result = await dispatcher(op)

    // [PROPUESTA] Fase 4a M3 — success hooks, purely additive: a guard
    // without `recordSuccess` is completely unaffected. Only reached when
    // `dispatcher(op)` resolved without throwing ("a successful dispatch").
    for (const guard of guards) {
      try {
        await guard.recordSuccess?.(ctx)
      } catch (err) {
        console.warn(`[guard:${guard.name}] recordSuccess failed:`, err instanceof Error ? err.message : err)
      }
    }

    return result
  }
}
