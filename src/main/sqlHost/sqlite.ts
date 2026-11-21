/**
 * SQLite files through the built-in `node:sqlite`. Statements run on the
 * host thread, so a statement cannot be cancelled: the host restarts instead.
 */

import { accessSync, constants } from 'node:fs';
import { constants as sqlite, DatabaseSync, type StatementSync } from 'node:sqlite';
import { expectOneRow, wholeRows, type DriverRows, type DriverSession } from '../../shared/sqlDriver';
import type { HostSessionConfig } from './protocol';
import { introspectSqlite, sqliteColumnType } from '../../shared/sqlCatalog/sqlite';

/**
 * Opens one file and nothing else: ATTACH, and VACUUM INTO which goes
 * through it, could reach files outside the path main checked.
 */
function open(path: string, readOnly: boolean): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly });
  db.setAuthorizer((action) => (action === sqlite.SQLITE_ATTACH ? sqlite.SQLITE_DENY : sqlite.SQLITE_OK));
  return db;
}

/** Steps to the first row now, so the run's execute time covers the work before any row exists. */
function rowsOf(statement: StatementSync, planMs: number): DriverRows {
  statement.setReadBigInts(true);
  const columns = statement.columns().map((column) => ({ name: column.name, type: sqliteColumnType(column.type) }));
  const iterator = statement.iterate() as Iterator<Record<string, unknown>>;
  const head = iterator.next();
  let done = head.done === true;
  let first: Record<string, unknown> | undefined = done ? undefined : { ...head.value };
  return {
    columns,
    planMs,
    async next(limit) {
      const rows = first ? [first] : [];
      first = undefined;
      while (rows.length < limit && !done) {
        const step = iterator.next();
        if (step.done) done = true;
        else rows.push({ ...step.value });
      }
      return { rows, done };
    },
    async close() {
      done = true;
      first = undefined;
      iterator.return?.();
    },
  };
}

export async function openSqlite(config: HostSessionConfig): Promise<DriverSession> {
  const path = config.path ?? '';
  accessSync(path, constants.R_OK);
  const db = open(path, config.readOnly);

  return {
    async version() {
      const row = db.prepare('SELECT sqlite_version() AS v').get() as { v?: string } | undefined;
      return `SQLite ${row?.v ?? ''}`;
    },

    async run(sql, { readWrite }) {
      // A read-only file connection lifts read-only for one run on its own handle.
      const own = readWrite && config.readOnly;
      const target = own ? open(path, false) : db;
      try {
        const planStart = performance.now();
        const statement = target.prepare(sql);
        const planMs = performance.now() - planStart;
        if (statement.columns().length > 0) {
          const rows = rowsOf(statement, planMs);
          // Its own handle closes now, so read everything first.
          if (!own) return rows;
          const all = await rows.next(Number.MAX_SAFE_INTEGER);
          return { ...wholeRows(rows.columns, all.rows), planMs };
        }
        const result = statement.run();
        return { columns: [], affectedRows: Number(result.changes), planMs, next: async () => ({ rows: [], done: true }), close: async () => undefined };
      } finally {
        if (own) target.close();
      }
    },

    cancel: async () => false,

    async applyEdits(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [index, statement] of statements.entries()) expectOneRow(index, Number(db.prepare(statement.sql).run(...statement.params).changes));
        db.exec('COMMIT');
      } catch (err) {
        // SQLite may already have rolled back after a full disk or an I/O error.
        if (db.isTransaction) db.exec('ROLLBACK');
        throw err;
      }
    },

    async estimateRows() {
      return null;
    },

    introspect: (request) =>
      introspectSqlite(async (sql, values) => db.prepare(sql).all(...(values as Array<string | number>)) as Array<Record<string, unknown>>, request),

    async close() {
      db.close();
    },
  };
}
