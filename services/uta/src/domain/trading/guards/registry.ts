import type { OperationGuard, GuardRegistryEntry } from './types.js'
import { MaxPositionSizeGuard } from './max-position-size.js'
import { CooldownGuard } from './cooldown.js'
import { SymbolWhitelistGuard } from './symbol-whitelist.js'

const builtinGuards: GuardRegistryEntry[] = [
  { type: 'max-position-size', create: (opts) => new MaxPositionSizeGuard(opts) },
  { type: 'cooldown',          create: (opts, accountId) => new CooldownGuard(opts, accountId) },
  { type: 'symbol-whitelist',  create: (opts) => new SymbolWhitelistGuard(opts) },
]

const registry = new Map<string, GuardRegistryEntry['create']>(
  builtinGuards.map(g => [g.type, g.create]),
)

/** Register a custom guard type (for third-party extensions). */
export function registerGuard(entry: GuardRegistryEntry): void {
  registry.set(entry.type, entry.create)
}

/**
 * Resolve config entries into guard instances via the registry.
 *
 * [PROPUESTA] Fase 4a M2: with OPENALICE_RISK_STRICT=1, an unknown guard
 * type throws instead of being silently skipped — Fase 0 found that a
 * typo in accounts.json's `guards[]` disables that guard with nothing but
 * a console.warn. Without the var (the default), behavior is
 * byte-identical to before Fase 4a: still warn-and-skip.
 *
 * [PROPUESTA] Fase 4a: `accountId` is a new, optional second parameter
 * threaded through to each guard factory (used by CooldownGuard's M3 fix
 * to read/write the shared persistent risk state — see cooldown.ts).
 * Existing callers that omit it are unaffected; existing factories that
 * ignore it are unaffected.
 */
export function resolveGuards(
  configs: Array<{ type: string; options?: Record<string, unknown> }>,
  accountId?: string,
): OperationGuard[] {
  const strict = process.env['OPENALICE_RISK_STRICT'] === '1'
  const guards: OperationGuard[] = []
  for (const cfg of configs) {
    const factory = registry.get(cfg.type)
    if (!factory) {
      if (strict) {
        throw new Error(`guard: unknown type "${cfg.type}" (OPENALICE_RISK_STRICT=1 — refusing to silently skip a misconfigured guard)`)
      }
      console.warn(`guard: unknown type "${cfg.type}", skipped`)
      continue
    }
    guards.push(factory(cfg.options ?? {}, accountId))
  }
  return guards
}
