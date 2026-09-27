/**
 * [PROPUESTA] SQLite connection — Hito 1, item 2.
 *
 * `node:sqlite` per ADR-0002. WAL mode so the read-only status page
 * (item 6) can query concurrently with the engine's own writes without
 * blocking either side.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}
