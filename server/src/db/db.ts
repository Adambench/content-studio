import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { config } from '../config.ts';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const statements = new Map<string, StatementSync>();
function stmt(sql: string): StatementSync {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

export type Row = Record<string, SQLInputValue>;
export type Param = SQLInputValue | boolean | undefined;

const clean = (params: Param[]): SQLInputValue[] => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export const all = <T = Row>(sql: string, ...params: Param[]): T[] => stmt(sql).all(...clean(params)) as T[];
export const get = <T = Row>(sql: string, ...params: Param[]): T | undefined => stmt(sql).get(...clean(params)) as T | undefined;
export const run = (sql: string, ...params: Param[]) => stmt(sql).run(...clean(params));

let depth = 0;
/** Run `fn` in one transaction (nested calls join the outer one). */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

/** Apply the SQL files in migrations/ that haven't run yet, in name order. */
export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
  const dir = join(import.meta.dirname, 'migrations');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    tx(() => {
      db.exec(readFileSync(join(dir, name), 'utf8'));
      run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', name, Date.now());
    });
  }
}

/** JSON column → value, with a fallback for empty or broken text. */
export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? parseJson(row.value, fallback) : fallback;
}

export function setSetting(key: string, value: unknown) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
