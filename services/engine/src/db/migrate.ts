/**
 * [PROPUESTA] Migration runner — Hito 1, item 2.
 *
 * Numbered, ordered, idempotent: each migration runs at most once
 * (tracked in its own `migrations` table), inside a transaction so a
 * failing migration never leaves the schema half-applied. Never edit an
 * already-applied migration in place — add a new one (same convention
 * `docs/trading-engine/BACKLOG.md`'s schema-delta note already commits
 * this project to for the SQLite tables in later fases).
 */
import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  id: number
  name: string
  up: (db: DatabaseSync) => void
}

export function runMigrations(db: DatabaseSync, migrations: readonly Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    db.prepare('SELECT id FROM migrations').all().map((row) => row['id'] as number),
  )

  const ordered = [...migrations].sort((a, b) => a.id - b.id)
  for (const migration of ordered) {
    if (applied.has(migration.id)) continue
    db.exec('BEGIN')
    try {
      migration.up(db)
      db.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`migration ${migration.id} (${migration.name}) failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
    }
  }
}
