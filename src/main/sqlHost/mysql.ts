/** MySQL and MariaDB through `mysql2`: one streamed query, paused between pages. */

import { readFileSync } from 'node:fs';
import net from 'node:net';
import mysql from 'mysql2';
import type { Connection, ConnectionOptions, FieldPacket, Query } from 'mysql2';
import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import type { DriverRows, DriverSession } from './driver';
import { introspectMysql } from './mysqlCatalog';
import type { HostSessionConfig } from './protocol';

const BINARY_CHARSET = 63;
const TYPE_NAMES: Readonly<Record<number, string>> = {
  0x01: 'TINYINT',
  0x02: 'SMALLINT',
  0x03: 'INTEGER',
  0x04: 'REAL',
  0x05: 'DOUBLE',
  0x07: 'TIMESTAMP',
  0x08: 'BIGINT',
  0x09: 'INTEGER',
  0x0a: 'DATE',
  0x0b: 'TIME',
  0x0c: 'DATETIME',
  0x0d: 'YEAR',
  0x0f: 'VARCHAR',
  0x10: 'BIT',
  0xf5: 'JSON',
  0xf7: 'ENUM',
  0xf8: 'SET',
  0xff: 'GEOMETRY',
};

function columnType(field: FieldPacket): string {
  const code = field.columnType ?? field.type ?? -1;
  if (code === 0x00 || code === 0xf6) {
    const scale = field.decimals ?? 0;
    const precision = Math.max(1, (field.columnLength ?? 10) - (scale > 0 ? 2 : 1));
    return `DECIMAL(${precision},${scale})`;
  }
  if ([0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe].includes(code)) {
    return field.characterSet === BINARY_CHARSET ? 'BLOB' : code === 0xfe ? 'CHAR' : 'VARCHAR';
  }
  return TYPE_NAMES[code] ?? (field.typeName || 'UNKNOWN');
}

function sslOptions(config: HostSessionConfig): ConnectionOptions['ssl'] {
  const ssl = config.ssl ?? { mode: 'verify-full' as const };
  if (ssl.mode === 'disable') return undefined;
  const files = {
    ...(ssl.caPath ? { ca: readFileSync(ssl.caPath) } : {}),
    ...(ssl.certPath ? { cert: readFileSync(ssl.certPath) } : {}),
    ...(ssl.keyPath ? { key: readFileSync(ssl.keyPath) } : {}),
  };
  if (ssl.mode === 'prefer' || ssl.mode === 'require') return { ...files, rejectUnauthorized: false };
  return { ...files, rejectUnauthorized: true, verifyIdentity: ssl.mode === 'verify-full' };
}

function options(config: HostSessionConfig, ssl: ConnectionOptions['ssl']): ConnectionOptions {
  const port = config.port ?? 3306;
  const host = config.servername ?? config.address ?? 'localhost';
  return {
    // The hostname drives SNI and the identity check; the socket goes to the pinned address.
    host,
    port,
    ...(config.address ? { stream: () => net.connect({ host: config.address!, port }) } : {}),
    ...(config.database ? { database: config.database } : {}),
    ...(config.user ? { user: config.user } : {}),
    ...(config.password !== undefined ? { password: config.password } : {}),
    ...(ssl ? { ssl } : {}),
    connectTimeout: 10_000,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    jsonStrings: true,
    multipleStatements: false,
  };
}

function connect(opts: ConnectionOptions): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection(opts);
    connection.connect((err) => (err ? reject(err) : resolve(connection)));
  });
}

const query = <T>(connection: Connection, sql: string, values: unknown[] = []): Promise<T> =>
  new Promise((resolve, reject) => connection.query(sql, values, (err, rows) => (err ? reject(err) : resolve(rows as T))));

/** A server-side prepared statement: values never pass through client-side escaping, whatever sql_mode says. */
const prepared = <T>(connection: Connection, sql: string, values: unknown[]): Promise<T> =>
  new Promise((resolve, reject) => connection.execute({ sql, values }, (err, rows) => (err ? reject(err) : resolve(rows as T))));

const queryWithFields = (connection: Connection, sql: string): Promise<{ rows: unknown; fields: FieldPacket[] | undefined }> =>
  new Promise((resolve, reject) =>
    connection.query(sql, (err, rows, fields) => (err ? reject(err) : resolve({ rows, fields: fields as FieldPacket[] | undefined })))
  );

/** Streams one statement; the socket pauses whenever a page is full. `kill` stops the server side early. */
function stream(connection: Connection, sql: string, kill: () => Promise<boolean>): Promise<DriverRows> {
  return new Promise((resolve, reject) => {
    const q: Query = connection.query(sql);
    let columns: SqlColumnMetadata[] = [];
    let affectedRows: number | undefined;
    let buffer: Array<Record<string, unknown>> = [];
    let ended = false;
    let discarding = false;
    let failure: Error | null = null;
    let want = 1;
    let wake: (() => void) | null = null;
    let started = false;
    const notify = () => {
      const pending = wake;
      wake = null;
      pending?.();
    };
    const begin = () => {
      if (started) return;
      started = true;
      resolve({
        columns,
        ...(affectedRows !== undefined && columns.length === 0 ? { affectedRows } : {}),
        async next(limit) {
          want = limit;
          while (buffer.length < limit && !ended && !failure) {
            // resume() can deliver queued rows and the end synchronously, so wait first.
            const arrived = new Promise<void>((done) => (wake = done));
            connection.resume();
            await arrived;
          }
          if (failure && buffer.length === 0) throw failure;
          const rows = buffer.slice(0, limit);
          buffer = buffer.slice(rows.length);
          return { rows, done: ended && buffer.length === 0 };
        },
        async close() {
          if (ended || failure) return;
          // Stop the server, then drop whatever is still in flight so the session can run the next statement.
          discarding = true;
          want = Number.POSITIVE_INFINITY;
          buffer = [];
          await kill().catch(() => false);
          const drained = new Promise<void>((done) => {
            const check = () => (ended || failure ? done() : (wake = check));
            wake = check;
          });
          connection.resume();
          if (ended || failure) wake?.();
          await drained;
        },
      });
    };
    // A statement without a result set emits fields as undefined.
    q.on('fields', (fields: FieldPacket[] | undefined) => {
      columns = (fields ?? []).map((field) => ({ name: field.name, type: columnType(field) }));
    });
    q.on('result', (row: unknown) => {
      const record = row as Record<string, unknown> & { constructor?: { name?: string } };
      if (record.constructor?.name === 'ResultSetHeader') {
        affectedRows = Number(record.affectedRows ?? 0);
        return;
      }
      if (discarding) return;
      buffer.push(record);
      if (buffer.length >= want) connection.pause();
      begin();
      notify();
    });
    q.on('error', (err: Error) => {
      failure = err;
      if (!started) reject(err);
      notify();
    });
    q.on('end', () => {
      ended = true;
      begin();
      notify();
    });
  });
}

export async function openMysql(config: HostSessionConfig): Promise<DriverSession> {
  let ssl = sslOptions(config);
  let connection: Connection;
  try {
    connection = await connect(options(config, ssl));
  } catch (err) {
    if (config.ssl?.mode !== 'prefer' || !/does not support secure connection/i.test(String(err))) throw err;
    ssl = undefined;
    connection = await connect(options(config, ssl));
  }
  if (config.readOnly) await query(connection, 'SET SESSION TRANSACTION READ ONLY');

  async function killQuery(): Promise<boolean> {
    const side = await connect(options(config, ssl)).catch(() => null);
    if (!side) return false;
    try {
      await query(side, `KILL QUERY ${Number(connection.threadId)}`);
      return true;
    } catch {
      return false;
    } finally {
      side.destroy();
    }
  }

  return {
    async version() {
      const rows = await query<Array<{ v: string }>>(connection, 'SELECT VERSION() AS v');
      const raw = String(rows[0]?.v ?? '');
      return `${/mariadb/i.test(raw) ? 'MariaDB' : 'MySQL'} ${raw.split('-')[0]}`;
    },

    async run(sql, { readWrite }) {
      if (readWrite && config.readOnly) {
        await query(connection, 'SET SESSION TRANSACTION READ WRITE');
        try {
          const { rows, fields } = await queryWithFields(connection, sql);
          return whole(rows, fields);
        } finally {
          await query(connection, 'SET SESSION TRANSACTION READ ONLY').catch(() => undefined);
        }
      }
      if (!config.readOnly) return stream(connection, sql, killQuery);
      // Read-only holds per run: the session default is set again and the run gets its own
      // read-only transaction, so an earlier statement cannot have made the session writable.
      await query(connection, 'SET SESSION TRANSACTION READ ONLY');
      await query(connection, 'START TRANSACTION READ ONLY');
      let rows: DriverRows;
      try {
        rows = await stream(connection, sql, killQuery);
      } catch (err) {
        await query(connection, 'ROLLBACK').catch(() => undefined);
        throw err;
      }
      return {
        ...rows,
        async close() {
          await rows.close();
          await query(connection, 'ROLLBACK').catch(() => undefined);
        },
      };
    },

    cancel: killQuery,

    async estimateRows(sql) {
      // MySQL refuses EXPLAIN of a write in a read-only transaction, though EXPLAIN runs nothing; a
      // transaction that is always rolled back leaves the session default alone and undoes anything.
      try {
        await query(connection, 'START TRANSACTION READ WRITE');
        const rows = await query<Array<{ rows?: unknown }>>(connection, `EXPLAIN ${sql}`);
        const counts = rows.map((row) => Number(row.rows)).filter(Number.isFinite);
        return counts.length > 0 ? Math.max(...counts) : null;
      } catch {
        return null;
      } finally {
        await query(connection, 'ROLLBACK').catch(() => undefined);
      }
    },

    async introspect(request) {
      await query(connection, 'START TRANSACTION READ ONLY');
      try {
        return await introspectMysql(
          (sql, values) => (values.length > 0 ? prepared(connection, sql, values) : query(connection, sql)) as Promise<Array<Record<string, unknown>>>,
          request
        );
      } finally {
        await query(connection, 'ROLLBACK').catch(() => undefined);
      }
    },

    close: () => new Promise<void>((resolve) => connection.end(() => resolve())),
  };
}

function whole(result: unknown, fields: FieldPacket[] | undefined): DriverRows {
  if (!Array.isArray(result)) {
    const affected = Number((result as { affectedRows?: unknown } | null)?.affectedRows ?? 0);
    return { columns: [], affectedRows: affected, next: async () => ({ rows: [], done: true }), close: async () => undefined };
  }
  let rows = result as Array<Record<string, unknown>>;
  const columns = (fields ?? []).map((field) => ({ name: field.name, type: columnType(field) }));
  return {
    columns,
    async next(limit) {
      const page = rows.slice(0, limit);
      rows = rows.slice(page.length);
      return { rows: page, done: rows.length === 0 };
    },
    close: async () => undefined,
  };
}
