/**
 * [PROPUESTA] SIGNAL_ONLY replay driver — Hito 1 gate 1 evidence.
 *
 * Runs `runCycle()` — the exact same orchestration the real scheduler
 * calls — against the last N REAL, already-closed candle boundaries,
 * using REAL live data from the configured keyless source. No wall-clock
 * wait: this is what "3 real cycles" means per the approved answer to
 * the clarifying question this Hito 1 message raised — real data, real
 * decision code, no 3-hour block.
 *
 * Requires UTA running and reachable (default http://127.0.0.1:47333).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEngineConfig } from '../config/engine-config.js'
import { openDatabase } from '../db/database.js'
import { runMigrations } from '../db/migrate.js'
import { migrations } from '../db/migrations/0001-init.js'
import { Journal } from '../journal/journal.js'
import { MarketDataStore } from '../data/market-data-store.js'
import { EngineUtaClient } from '../uta/uta-client.js'
import { trendFollowingStrategy } from '../strategies/trend-following.js'
import { lastBoundaryAtOrBefore } from '../clock/candle-boundaries.js'
import { runCycle } from '../loop/run-cycle.js'

const STRATEGIES: Record<string, typeof trendFollowingStrategy> = {
  'trend-following': trendFollowingStrategy,
}

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? resolve(import.meta.dirname, '../config/engine-config.example.json')
  const dbPath = process.argv[3] ?? resolve(import.meta.dirname, '../../data/signal-only-replay.db')
  const cyclesArg = Number(process.argv[4] ?? 3)
  const utaBaseUrl = process.env['OPENALICE_UTA_URL'] ?? 'http://127.0.0.1:47333'

  const config = loadEngineConfig(JSON.parse(readFileSync(configPath, 'utf-8')))
  const strategy = STRATEGIES[config.strategy.id]
  if (!strategy) throw new Error(`unknown strategy id "${config.strategy.id}"`)

  const db = openDatabase(dbPath)
  runMigrations(db, migrations)
  const journal = new Journal(db)

  const client = new EngineUtaClient({ baseUrl: utaBaseUrl })
  const marketDataStore = new MarketDataStore({ client })

  const now = new Date()
  const mostRecentClosed = lastBoundaryAtOrBefore(now, config.interval)
  const intervalMsValue = mostRecentClosed.getTime() - lastBoundaryAtOrBefore(new Date(mostRecentClosed.getTime() - 1), config.interval).getTime()

  const closeAts: Date[] = []
  for (let i = cyclesArg - 1; i >= 0; i--) {
    closeAts.push(new Date(mostRecentClosed.getTime() - i * intervalMsValue))
  }

  console.log(`[replay] config=${configPath}`)
  console.log(`[replay] db=${dbPath}`)
  console.log(`[replay] uta=${utaBaseUrl}`)
  console.log(`[replay] strategy=${strategy.id}@${strategy.version} interval=${config.interval} universe=${config.universe.map((u) => u.label).join(', ')}`)
  console.log(`[replay] real closed boundaries to evaluate: ${closeAts.map((d) => d.toISOString()).join(', ')}`)
  console.log('')

  for (const closeAt of closeAts) {
    const result = await runCycle({ config, marketDataStore, strategy, journal, closeAt })
    console.log(`=== cycle_id=${result.cycleId} closeAt=${closeAt.toISOString()} ===`)
    for (const d of result.decisions) {
      const summary = d.decision.kind === 'ENTER'
        ? `ENTER ${d.decision.side} entry=${d.decision.entry} stop=${d.decision.stop} score=${d.decision.score.toFixed(2)} reasons=${d.decision.reasonCodes.join('|')}`
        : d.decision.kind === 'EXIT'
          ? `EXIT reasons=${d.decision.reasonCodes.join('|')}`
          : d.decision.kind === 'ADJUST_STOP'
            ? `ADJUST_STOP newStop=${d.decision.newStop}`
            : `NONE reasons=${(d.decision.reasonCodes ?? []).join('|') || '(none)'}`
      console.log(`  ${d.symbol.padEnd(20)} bars=${d.barsUsed.toString().padStart(3)}  ${summary}`)
    }
    console.log('')
  }

  console.log(`[replay] done — ${closeAts.length} real cycles recorded in ${dbPath}`)
}

main().catch((err) => {
  console.error('[replay] fatal:', err)
  process.exit(1)
})
