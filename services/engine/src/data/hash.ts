import { createHash } from 'node:crypto'
import type { Bar } from '@traderalice/uta-protocol'

/**
 * Content hash of a bar dataset — PROMPT_MASTER_CLAUDE_CODE.md §37 F2
 * acceptance: "descargar las mismas barras dos veces → mismo hash".
 *
 * Pure and order-sensitive by design: bars already arrive time-ordered from
 * the broker, and a silent reorder is itself a data-quality signal worth
 * catching, not something to normalize away here.
 */
export function hashBars(bars: readonly Bar[]): string {
  const canonical = bars
    .map((b) => `${b.timestamp.toISOString()}|${b.open}|${b.high}|${b.low}|${b.close}|${b.volume}`)
    .join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}
