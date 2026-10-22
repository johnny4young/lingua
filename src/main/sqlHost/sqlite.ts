/**
 * SQLite files through the built-in `node:sqlite`. Statements run on the
 * host thread, so a statement cannot be cancelled: the host restarts instead.
 */

import { accessSync, constants } from 'node:fs';
import { constants as sqlite, DatabaseSync, type StatementSync } from 'node:sqlite';
import { expectOneRow, type DriverRows, type DriverSession } from './driver';
import type { HostSessionConfig } from './protocol';
import { introspectSqlite } from './sqliteCatalog';

/** Declared column types, by SQLite affinity, in the names the grid knows. */
function columnType(declared: string | null | undefined): string {
  const type = (declared ?? '').toUpperCase();
  if (type === '') return 'VALUE';
  if (/INT/.test(type)) return type === 'INTEGER' || type === 'BIGINT' || type === 'SMALLINT' ? type : 'BIGINT';
  if (/REAL|FLOA|DOUB/.test(type)) return 'DOUBLE';
  if (/DECIMAL|NUMERIC/.test(type)) return 'DECIMAL';
  if (/BLOB/.test(type)) return 'BLOB';
  return type;
}

/**
 * Opens one file and nothing else: ATTACH, and VACUUM INTO which goes
 * through it, could reach files outside the path main checked.
 */
function open(path: string, readOnly: boolean): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly });
  db.setAuthorizer((action) => (action === sqlite.SQLITE_ATTACH ? sqlite.SQLITE_DENY : sqlite.SQLITE_OK));
  return db;
}

function rowsOf(statement: StatementSync): DriverRows {
  statement.setReadBigInts(true);
  const columns = statement.columns().map((column) => ({ name: column.name, type: columnType(column.type) }));
  const iterator = statement.iterate() as Iterator<Record<string, unknown>>;
  let done = false;
  return {
    columns,
    async next(limit) {
      const rows: Array<Record<string, unknown>> = [];
      while (rows.length < limit && !done) {
        const step = iterator.next();
        if (step.done) done = true;
        else rows.push({ ...step.value });
      }
      return { rows, done };
    },
    async close() {
      done = true;
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
        const statement = target.prepare(sql);
        if (statement.columns().length > 0) {
          const rows = rowsOf(statement);
          // Its own handle closes now, so read everything first.
          if (!own) return rows;
          const all = await rows.next(Number.MAX_SAFE_INTEGER);
          let left = all.rows;
          return {
            columns: rows.columns,
            async next(limit) {
              const page = left.slice(0, limit);
              left = left.slice(page.length);
              return { rows: page, done: left.length === 0 };
            },
            close: async () => undefined,
          };
        }
        const result = statement.run();
        return { columns: [], affectedRows: Number(result.changes), next: async () => ({ rows: [], done: true }), close: async () => undefined };
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
