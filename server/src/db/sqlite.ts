import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/**
 * Node's built-in SQLite, wrapped in the slice of better-sqlite3's API that drizzle's better-sqlite3 driver
 * uses. Built in means no native module to compile for Electron.
 */
export function openDatabase(file: string) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const transaction = <A extends unknown[], R>(fn: (...args: A) => R) => {
    const run =
      (behavior: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE') =>
      (...args: A): R => {
        db.exec(`BEGIN ${behavior}`);
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          return result;
        } catch (err) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw err;
        }
      };
    return Object.assign(run('DEFERRED'), { deferred: run('DEFERRED'), immediate: run('IMMEDIATE'), exclusive: run('EXCLUSIVE') });
  };

  return {
    exec: (sql: string) => db.exec(sql),
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let arrays: StatementSync | undefined;
      // drizzle asks for rows as arrays via .raw(); node:sqlite does that per statement.
      const raw = () => {
        if (!arrays) {
          arrays = db.prepare(sql);
          arrays.setReturnArrays(true);
        }
        return arrays;
      };
      return {
        run: (...params: SQLInputValue[]) => stmt.run(...params),
        all: (...params: SQLInputValue[]) => stmt.all(...params),
        get: (...params: SQLInputValue[]) => stmt.get(...params),
        raw: () => ({ all: (...params: SQLInputValue[]) => raw().all(...params), get: (...params: SQLInputValue[]) => raw().get(...params) }),
      };
    },
    transaction,
    close: () => db.close(),
  };
}
