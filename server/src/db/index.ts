import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { config } from '../config';
import * as schema from './schema';
import { openDatabase } from './sqlite';

const sqlite = openDatabase(config.dbFile);

/**
 * drizzle's better-sqlite3 database, assembled by hand (as its driver does) around our node:sqlite shim.
 * Importing the driver itself would pull in the better-sqlite3 native module, which we don't ship.
 */
function createDb() {
  const dialect = new SQLiteSyncDialect();
  const tables = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
  const schemaConfig = { fullSchema: schema, schema: tables.tables, tableNamesMap: tables.tableNamesMap };
  const session = new BetterSQLiteSession(sqlite as never, dialect, schemaConfig as never, {});
  return new BaseSQLiteDatabase('sync', dialect, session, schemaConfig as never) as unknown as BetterSQLite3Database<typeof schema>;
}

export const db = createDb();
/** The database itself, for what drizzle can't say (a backup copy). */
export const rawDb = sqlite;
export { schema };

export function runMigrations() {
  migrate(db, { migrationsFolder: config.migrationsDir });
}

export const newId = () => crypto.randomUUID();
export const now = () => Date.now();
