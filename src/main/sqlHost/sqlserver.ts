/**
 * SQL Server through `tedious`, loaded on first use: one request streams its
 * rows, paused between pages. Read-only runs inside a transaction that is
 * always rolled back, since SQL Server has no read-only transaction mode.
 */

import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { Connection, ConnectionConfiguration, Request } from 'tedious';
import type { ColumnMetadata } from 'tedious/lib/token/colmetadata-token-parser';
import { ROW_EDIT_BUDGET_MS } from '../../shared/sqlRowEdits';
import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import { EDIT_LOCK_WAIT_S, editDeadline, expectOneRow, type DriverRows, type DriverSession } from '../../shared/sqlDriver';
import type { HostSessionConfig } from './protocol';
import { introspectSqlServer } from './sqlserverCatalog';

type Tedious = typeof import('tedious');
let loaded: Promise<Tedious> | undefined;
// Loading tedious pulls in the Azure SDK; only a SQL Server connection pays for it.
const tedious = () => (loaded ??= import('tedious').then((mod) => ((mod as { default?: Tedious }).default ?? mod) as Tedious));

const CATALOG_TIMEOUT_MS = 25_000;

const TYPE_NAMES: Readonly<Record<string, string>> = {
  Int: 'INTEGER',
  BigInt: 'BIGINT',
  SmallInt: 'SMALLINT',
  TinyInt: 'UTINYINT',
  Bit: 'BOOLEAN',
  Float: 'DOUBLE',
  Real: 'REAL',
  Money: 'DECIMAL(19,4)',
  SmallMoney: 'DECIMAL(10,4)',
  VarChar: 'VARCHAR',
  NVarChar: 'VARCHAR',
  Char: 'CHAR',
  NChar: 'CHAR',
  Text: 'VARCHAR',
  NText: 'VARCHAR',
  Date: 'DATE',
  Time: 'TIME',
  DateTime: 'TIMESTAMP',
  DateTime2: 'TIMESTAMP',
  SmallDateTime: 'TIMESTAMP',
  DateTimeOffset: 'TIMESTAMP WITH TIME ZONE',
  UniqueIdentifier: 'UUID',
  VarBinary: 'BLOB',
  Binary: 'BLOB',
  Image: 'BLOB',
  Xml: 'XML',
};

/** The TDS type as the names the grid already knows; nullable variants (IntN, DecimalN…) share their base name. */
function columnType(meta: ColumnMetadata): string {
  const raw = meta.type.name;
  const name = raw in TYPE_NAMES || raw === 'Decimal' || raw === 'Numeric' ? raw : raw.replace(/N$/, '');
  if (name === 'Decimal' || name === 'Numeric') return meta.precision ? `DECIMAL(${meta.precision},${meta.scale ?? 0})` : 'DECIMAL';
  return TYPE_NAMES[name] ?? name.toUpperCase();
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** Dates and times as SQL Server prints them, read in UTC as tedious hands them over. */
function cellValue(value: unknown, type: string): unknown {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
  const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(value.getUTCMilliseconds(), 3)}`;
  if (type === 'DATE') return date;
  if (type === 'TIME') return time;
  if (type === 'TIMESTAMP') return `${date} ${time}`;
  return value.toISOString();
}

type Tls = Pick<NonNullable<ConnectionConfiguration['options']>, 'encrypt' | 'trustServerCertificate' | 'cryptoCredentialsDetails'>;

/** TLS as tedious takes it. verify-ca also checks the name: tedious has no way to check the chain alone. */
function sqlServerTls(config: HostSessionConfig): Tls {
  const ssl = config.ssl ?? { mode: 'verify-full' as const };
  if (ssl.mode === 'disable') return { encrypt: false, trustServerCertificate: true };
  const files = {
    ...(ssl.caPath ? { ca: readFileSync(ssl.caPath) } : {}),
    ...(ssl.certPath ? { cert: readFileSync(ssl.certPath) } : {}),
    ...(ssl.keyPath ? { key: readFileSync(ssl.keyPath) } : {}),
  };
  const verify = ssl.mode === 'verify-ca' || ssl.mode === 'verify-full';
  return { encrypt: true, trustServerCertificate: !verify, cryptoCredentialsDetails: files };
}

function connectionConfig(config: HostSessionConfig, tls: Tls, socket?: () => Duplex): ConnectionConfiguration {
  const host = config.servername ?? config.address ?? 'localhost';
  const port = config.port ?? 1433;
  return {
    // The hostname drives SNI and the certificate check; the socket goes to the pinned address, or is a tunnel channel.
    server: host,
    authentication: { type: 'default', options: { userName: config.user ?? '', password: config.password ?? '' } },
    options: {
      port,
      ...(config.database ? { database: config.database } : {}),
      ...tls,
      appName: 'Lingua',
      connectTimeout: 10_000,
      requestTimeout: 0,
      rowCollectionOnRequestCompletion: false,
      useColumnNames: false,
      connector: async () => {
        const stream = socket ? socket() : net.connect({ host: config.address ?? host, port });
        await once(stream, 'connect');
        return stream as net.Socket;
      },
    },
  };
}

/** Server error 4060: the database cannot be opened, which the login failure that follows it hides. */
const NO_DATABASE = 4060;

async function open(lib: Tedious, config: HostSessionConfig, tls: Tls, socket?: () => Duplex): Promise<Connection> {
  const connection = new lib.Connection(connectionConfig(config, tls, socket));
  let missingDatabase: string | undefined;
  const onMessage = (message: { number: number; message: string }) => {
    if (message.number === NO_DATABASE) missingDatabase = message.message;
  };
  connection.on('errorMessage', onMessage);
  try {
    await new Promise<void>((resolve, reject) =>
      connection.connect((err) => (err ? reject(missingDatabase ? Object.assign(new Error(missingDatabase), { code: (err as { code?: string }).code }) : err) : resolve()))
    );
  } finally {
    connection.removeListener('errorMessage', onMessage);
  }
  return connection;
}

/** A whole batch whose rows are collected; for the short statements the driver runs itself. */
function batch(lib: Tedious, connection: Connection, sql: string, timeoutMs = 0): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const rows: Array<Record<string, unknown>> = [];
    let names: string[] = [];
    const request = new lib.Request(sql, (err) => (err ? reject(err) : resolve(rows)));
    if (timeoutMs > 0) request.setTimeout(timeoutMs);
    request.on('columnMetadata', (columns) => {
      names = (Array.isArray(columns) ? columns : Object.values(columns)).map((column, index) => column.colName || `column${index + 1}`);
    });
    request.on('row', (columns: Array<{ value: unknown }>) => rows.push(Object.fromEntries(columns.map((column, index) => [names[index]!, column.value]))));
    connection.execSqlBatch(request);
  });
}

/** A parameterised statement; values bind as `@p1`, `@p2`… and the server converts them to each column's type. */
function parameterised(lib: Tedious, connection: Connection, sql: string, values: readonly unknown[], timeoutMs: number): Promise<{ rows: Array<Record<string, unknown>>; count: number }> {
  return new Promise((resolve, reject) => {
    const rows: Array<Record<string, unknown>> = [];
    let names: string[] = [];
    const request = new lib.Request(sql, (err, count) => (err ? reject(err) : resolve({ rows, count: count ?? 0 })));
    request.setTimeout(timeoutMs);
    values.forEach((value, index) => request.addParameter(`p${index + 1}`, lib.TYPES.NVarChar, value === null ? null : String(value)));
    request.on('columnMetadata', (columns) => {
      names = (Array.isArray(columns) ? columns : Object.values(columns)).map((column, index) => column.colName || `column${index + 1}`);
    });
    request.on('row', (columns: Array<{ value: unknown }>) => rows.push(Object.fromEntries(columns.map((column, index) => [names[index]!, column.value]))));
    connection.execSql(request);
  });
}

/** Streams one batch; the request pauses whenever a page is full. */
function stream(lib: Tedious, connection: Connection, sql: string): Promise<DriverRows> {
  return new Promise((resolve, reject) => {
    let request: Request;
    let columns: SqlColumnMetadata[] = [];
    let buffer: Array<Record<string, unknown>> = [];
    let ended = false;
    let failure: Error | null = null;
    let affectedRows: number | undefined;
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
            const arrived = new Promise<void>((done) => (wake = done));
            request.resume();
            await arrived;
          }
          if (failure && buffer.length === 0) throw failure;
          const rows = buffer.slice(0, limit);
          buffer = buffer.slice(rows.length);
          return { rows, done: ended && buffer.length === 0 };
        },
        async close() {
          if (ended || failure) return;
          buffer = [];
          want = Number.POSITIVE_INFINITY;
          const finished = new Promise<void>((done) => {
            const check = () => (ended || failure ? done() : (wake = check));
            wake = check;
          });
          connection.cancel();
          request.resume();
          await finished;
        },
      });
    };
    request = new lib.Request(sql, (err, rowCount) => {
      if (err) {
        failure = err;
        if (!started) reject(err);
      } else {
        if (columns.length === 0) affectedRows = rowCount ?? 0;
        ended = true;
        begin();
      }
      notify();
    });
    // A batch can return several result sets; the grid shows the first.
    let resultSets = 0;
    request.on('columnMetadata', (metadata) => {
      resultSets += 1;
      if (resultSets > 1) return;
      const list = Array.isArray(metadata) ? metadata : Object.values(metadata);
      columns = list.map((column, index) => ({ name: column.colName || `column${index + 1}`, type: columnType(column) }));
    });
    request.on('row', (row: Array<{ value: unknown }>) => {
      if (want === Number.POSITIVE_INFINITY || resultSets > 1) return;
      buffer.push(Object.fromEntries(row.map((cell, index) => [columns[index]!.name, cellValue(cell.value, columns[index]!.type)])));
      if (buffer.length >= want) request.pause();
      begin();
      notify();
    });
    connection.execSqlBatch(request);
  });
}

/** `EXPLAIN …` is how Lingua asks for a plan; SQL Server has no such statement, so it never collides. */
const EXPLAIN_PREFIX = /^\s*EXPLAIN\s+/i;

export async function openSqlServer(config: HostSessionConfig, socket?: () => Duplex): Promise<DriverSession> {
  const lib = await tedious();
  let tls = sqlServerTls(config);
  let connection: Connection;
  try {
    connection = await open(lib, config, tls, socket);
  } catch (err) {
    // prefer: fall back to a plain session only when the server itself says it cannot encrypt.
    const code = (err as { code?: unknown }).code;
    if (config.ssl?.mode !== 'prefer' || code !== 'EENCRYPT' || !/did not negotiate encryption/i.test(String(err))) throw err;
    tls = { encrypt: false, trustServerCertificate: true };
    connection = await open(lib, config, tls, socket);
  }
  let lost: (() => void) | undefined;
  // A fatal error with nothing waiting is emitted; unheard, it would end the host.
  connection.on('error', () => lost?.());
  connection.on('end', () => lost?.());
  const run = (sql: string, timeoutMs = 0) => batch(lib, connection, sql, timeoutMs);

  /** The estimated plan of one statement, without running it. */
  async function plan(sql: string): Promise<Array<Record<string, unknown>>> {
    await run('SET SHOWPLAN_ALL ON');
    try {
      return await run(sql);
    } finally {
      await run('SET SHOWPLAN_ALL OFF').catch(() => undefined);
    }
  }

  return {
    async version() {
      const [row] = await run("SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS v, CAST(SERVERPROPERTY('EngineEdition') AS int) AS e");
      return `${Number(row?.e) === 5 ? 'Azure SQL Database' : 'SQL Server'} ${String(row?.v ?? '')}`.trim();
    },

    async run(sql, { readWrite }) {
      if (EXPLAIN_PREFIX.test(sql)) {
        const rows = await plan(sql.replace(EXPLAIN_PREFIX, ''));
        return whole(rows);
      }
      // Read-only runs inside a transaction that is always rolled back; a confirmed write runs as is.
      const guarded = config.readOnly && !readWrite;
      if (guarded) await run('BEGIN TRANSACTION');
      const end = () => (guarded ? run('IF @@TRANCOUNT > 0 ROLLBACK').then(() => undefined, () => undefined) : Promise.resolve());
      let rows: DriverRows;
      try {
        rows = await stream(lib, connection, sql);
      } catch (err) {
        await end();
        throw err;
      }
      if (!guarded) return rows;
      return {
        ...rows,
        async close() {
          await rows.close();
          await end();
        },
      };
    },

    async cancel() {
      return connection.cancel();
    },

    encrypted: () => tls.encrypt === true,

    async estimateRows(sql) {
      try {
        const rows = await plan(sql);
        const estimate = Number(rows[0]?.EstimateRows);
        return Number.isFinite(estimate) ? Math.round(estimate) : null;
      } catch {
        return null;
      }
    },

    async introspect(request) {
      // Waits on another session's lock fail instead of holding the Explorer.
      await run('SET LOCK_TIMEOUT 10000');
      return introspectSqlServer(async (sql, values) => (await parameterised(lib, connection, sql, values, CATALOG_TIMEOUT_MS)).rows, request);
    },

    async applyEdits(statements) {
      const inTime = editDeadline();
      // A blocked or slow statement fails on the server, so the transaction can never commit late.
      await run(`SET LOCK_TIMEOUT ${EDIT_LOCK_WAIT_S * 1000}`);
      await run('BEGIN TRANSACTION');
      try {
        for (const [index, statement] of statements.entries()) {
          inTime();
          expectOneRow(index, (await parameterised(lib, connection, statement.sql, statement.params, ROW_EDIT_BUDGET_MS / 2)).count);
        }
        inTime();
        await run('COMMIT');
      } catch (err) {
        await run('IF @@TRANCOUNT > 0 ROLLBACK').catch(() => undefined);
        throw err;
      }
    },

    onLost(listener) {
      lost = listener;
    },

    close: () =>
      new Promise<void>((resolve) => {
        // A connection that already ended emits no second end.
        if (connection.closed) return resolve();
        connection.once('end', () => resolve());
        connection.close();
      }),
  };
}

function whole(result: Array<Record<string, unknown>>): DriverRows {
  let rows = result;
  const names = Object.keys(rows[0] ?? {});
  return {
    columns: names.map((name) => ({ name, type: typeof rows[0]?.[name] === 'number' ? 'DOUBLE' : 'VARCHAR' })),
    async next(limit) {
      const page = rows.slice(0, limit);
      rows = rows.slice(page.length);
      return { rows: page, done: rows.length === 0 };
    },
    close: async () => undefined,
  };
}
