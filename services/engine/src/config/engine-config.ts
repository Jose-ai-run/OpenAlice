/**
 * [PROPUESTA] Engine runtime config — Hito 1, item 3.
 *
 * Real config: no synthetic symbols, no invented aliceIds — every
 * `universe` entry must be an id this Engine actually verified against
 * the live keyless source before it went in the example file (see
 * engine-config.example.json's header comment... JSON has no comments,
 * so the verification is recorded in docs/trading-engine/AUDIT.md
 * instead).
 */
import { z } from 'zod'
import type { BarInterval } from '@traderalice/uta-protocol'

const BAR_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const satisfies readonly BarInterval[]

export const universeEntrySchema = z.object({
  /** Human-facing label, e.g. "BTC/USDT perp". Not used for lookups. */
  label: z.string().min(1),
  /** The UTA account id this symbol is fetched from — e.g. "bybit-readonly". */
  utaId: z.string().min(1),
  /** The canonical `<utaId>|<broker-symbol>` id — verified real, never invented. */
  aliceId: z.string().min(1).refine((v) => v.includes('|'), 'aliceId must be "<utaId>|<symbol>"'),
})
export type UniverseEntry = z.infer<typeof universeEntrySchema>

export const engineConfigSchema = z.object({
  mode: z.enum(['SIGNAL_ONLY', 'PAPER']),
  interval: z.enum(BAR_INTERVALS),
  /** How many closed bars of history to fetch per cycle — must cover the
   *  strategy's slowest lookback with margin. */
  historyBars: z.number().int().positive().default(120),
  strategy: z.object({
    id: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  universe: z.array(universeEntrySchema).min(1),
  /** Only meaningful in PAPER mode — the UTA account orders are staged
   *  against. Unused, and may be omitted, in SIGNAL_ONLY. */
  paperAccountId: z.string().min(1).optional(),
}).refine(
  (cfg) => cfg.mode !== 'PAPER' || Boolean(cfg.paperAccountId),
  { message: 'paperAccountId is required when mode is PAPER', path: ['paperAccountId'] },
)
export type EngineConfig = z.infer<typeof engineConfigSchema>

export function loadEngineConfig(raw: unknown): EngineConfig {
  return engineConfigSchema.parse(raw)
}
