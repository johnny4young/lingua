/** Postgres through `pg` and `pg-cursor`: rows stream in pages from a server-side portal. */

import type { Duplex } from 'node:stream';
import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import pg from 'pg';
import Cursor from 'pg-cursor';
import type { FieldDef, QueryResult } from 'pg';
import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import { expectOneRow, type DriverRows, type DriverSession } from './driver';
import { introspectPostgres } from './postgresCatalog';
import type { HostSessionConfig } from './protocol';

// Dates, times, intervals, JSON and money stay as the server prints them.
const RAW_TEXT_OIDS = new Set([1082, 1083, 1114, 1184, 1266, 1186, 114, 3802, 790]);
const types = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    RAW_TEXT_OIDS.has(oid) ? (value: string) => value : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser,
};

const TYPE_NAMES: Readonly<Record<number, string>> = {
  16: 'BOOLEAN',
  17: 'BLOB',
  18: 'CHAR',
  19: 'NAME',
  20: 'BIGINT',
  21: 'SMALLINT',
  23: 'INTEGER',
  25: 'TEXT',
  26: 'OID',
  114: 'JSON',
  142: 'XML',
  700: 'REAL',
  701: 'DOUBLE',
  790: 'MONEY',
  1042: 'CHAR',
  1043: 'VARCHAR',
  1082: 'DATE',
  1083: 'TIME',
  1114: 'TIMESTAMP',
  1184: 'TIMESTAMP WITH TIME ZONE',
  1186: 'INTERVAL',
  1266: 'TIME WITH TIME ZONE',
  1700: 'DECIMAL',
  2950: 'UUID',
  3802: 'JSONB',
};

function columnType(field: FieldDef): string {
  if (field.dataTypeID === 1700 && field.dataTypeModifier > 4) {
    const mod = field.dataTypeModifier - 4;
    return `DECIMAL(${(mod >> 16) & 0xffff},${mod & 0xffff})`;
  }
  return TYPE_NAMES[field.dataTypeID] ?? `OID ${field.dataTypeID}`;
}

function pgSsl(config: HostSessionConfig): ConnectionOptions | false {
  const ssl = config.ssl ?? { mode: 'verify-full' as const };
  if (ssl.mode === 'disable') return false;
  const files: ConnectionOptions = {
    ...(ssl.caPath ? { ca: readFileSync(ssl.caPath) } : {}),
    ...(ssl.certPath ? { cert: readFileSync(ssl.certPath) } : {}),
    ...(ssl.keyPath ? { key: readFileSync(ssl.keyPath) } : {}),
    ...(config.servername ? { servername: config.servername } : {}),
  };
  if (ssl.mode === 'prefer' || ssl.mode === 'require') return { ...files, rejectUnauthorized: false };
  // verify-ca checks the chain only; verify-full also checks the name.
  return ssl.mode === 'verify-ca' ? { ...files, rejectUnauthorized: true, checkServerIdentity: () => undefined } : { ...files, rejectUnauthorized: true };
}

function clientConfig(config: HostSessionConfig, ssl: ConnectionOptions | false, connect?: () => Duplex): pg.ClientConfig {
  return {
    ...(connect ? { stream: connect } : {}),
    host: config.address ?? config.servername ?? 'localhost',
    port: config.port ?? 5432,
    ...(config.database ? { database: config.database } : {}),
    ...(config.user ? { user: config.user } : {}),
    // A function keeps pg from falling back to PGPASSWORD or a .pgpass file for another host.
    password: () => config.password ?? '',
    ssl,
    application_name: 'Lingua',
    connectionTimeoutMillis: 10_000,
    types,
  };
}

/** One statement over the extended protocol, which refuses a string holding several; `queryMode` is missing from the pg typings. */
const oneStatement = (text: string): pg.QueryConfig => ({ text, queryMode: 'extended' }) as pg.QueryConfig;

function readPage(cursor: Cursor, limit: number): Promise<{ rows: Array<Record<string, unknown>>; result: QueryResult }> {
  return new Promise((resolve, reject) => {
    cursor.read(limit, (err, rows, result) => (err ? reject(err) : resolve({ rows, result })));
  });
}

export async function openPostgres(config: HostSessionConfig, connect?: () => Duplex): Promise<DriverSession> {
  let ssl = pgSsl(config);
  let client = new pg.Client(clientConfig(config, ssl, connect));
  try {
    await client.connect();
  } catch (err) {
    // prefer: fall back to plain TCP when the server has no TLS.
    if (config.ssl?.mode !== 'prefer' || !/does not support SSL/i.test(String(err))) throw err;
    ssl = false;
    client = new pg.Client(clientConfig(config, ssl, connect));
    await client.connect();
  }
  let lost: (() => void) | undefined;
  // An idle client whose socket drops emits 'error'; unheard, that would end the host.
  client.on('error', () => lost?.());
  if (config.readOnly) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const processId = (client as unknown as { processID?: number }).processID;

  return {
    async version() {
      const result = await client.query<{ server_version: string }>('SHOW server_version');
      return `PostgreSQL ${String(result.rows[0]?.server_version ?? '').split(' ')[0]}`;
    },

    async applyEdits(statements) {
      await client.query('BEGIN');
      try {
        for (const [index, statement] of statements.entries()) expectOneRow(index, (await client.query(statement.sql, statement.params)).rowCount);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    },

    async run(sql, { readWrite }) {
      if (readWrite && config.readOnly) {
        // One read-write transaction for this run; the extended protocol keeps it to one statement.
        await client.query('BEGIN READ WRITE');
        try {
          const result = await client.query(oneStatement(sql));
          await client.query('COMMIT');
          return wholeResult(result);
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        }
      }
      // Every run on a read-only connection gets its own read-only transaction, so a statement
      // that changes the session default cannot make the next one writable.
      const guarded = config.readOnly;
      if (guarded) await client.query('BEGIN READ ONLY');
      const end = () => (guarded ? client.query('ROLLBACK').then(() => undefined, () => undefined) : Promise.resolve());
      const cursor = client.query(new Cursor(sql, undefined, { types }));
      let first: { rows: Array<Record<string, unknown>>; result: QueryResult };
      try {
        first = await readPage(cursor, 1);
      } catch (err) {
        await cursor.close().catch(() => undefined);
        await end();
        throw err;
      }
      const columns = (first.result.fields ?? []).map((field) => ({ name: field.name, type: columnType(field) }));
      let pending = first.rows;
      let done = first.rows.length === 0;
      return {
        columns,
        ...(columns.length === 0 && first.result.rowCount != null ? { affectedRows: first.result.rowCount } : {}),
        async next(limit) {
          const rows = pending.slice(0, limit);
          pending = pending.slice(rows.length);
          while (rows.length < limit && !done) {
            const page = await readPage(cursor, limit - rows.length);
            rows.push(...page.rows);
            if (page.rows.length === 0) done = true;
          }
          return { rows, done: done && pending.length === 0 };
        },
        async close() {
          await cursor.close().catch(() => undefined);
          await end();
        },
      };
    },

    async cancel() {
      if (!processId) return false;
      const side = new pg.Client(clientConfig(config, ssl, connect));
      try {
        await side.connect();
        await side.query('SELECT pg_cancel_backend($1)', [processId]);
        return true;
      } catch {
        return false;
      } finally {
        await side.end().catch(() => undefined);
      }
    },

    onLost(listener) {
      lost = listener;
    },

    async estimateRows(sql) {
      try {
        // A read-only transaction that is rolled back: the plan is all this may produce.
        await client.query('BEGIN READ ONLY');
        const result = await client.query(oneStatement(`EXPLAIN (FORMAT JSON) ${sql}`));
        const plan = (result.rows[0] as Record<string, unknown> | undefined)?.['QUERY PLAN'];
        const parsed = typeof plan === 'string' ? JSON.parse(plan) : plan;
        const plan0 = Array.isArray(parsed) ? parsed[0]?.Plan : undefined;
        // A write's top node reports 0; the scan below it holds the estimate.
        const node = plan0?.['Node Type'] === 'ModifyTable' && Array.isArray(plan0.Plans) ? plan0.Plans[0] : plan0;
        const rows = node?.['Plan Rows'];
        return typeof rows === 'number' ? rows : null;
      } catch {
        return null;
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    },

    tls() {
      if (ssl === false) return undefined;
      const socket = (client as unknown as { connection?: { stream?: { getPeerCertificate?: () => { subject?: { CN?: string }; valid_to?: string } } } }).connection?.stream;
      const cert = socket?.getPeerCertificate?.();
      if (!cert || !cert.subject) return undefined;
      return { ...(cert.subject.CN ? { subject: cert.subject.CN } : {}), ...(cert.valid_to ? { validTo: cert.valid_to } : {}) };
    },

    async introspect(request) {
      // Catalog functions resolve in pg_catalog only, so a same-named function elsewhere on the path never runs.
      await client.query('BEGIN READ ONLY');
      try {
        await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
        await client.query('SET LOCAL statement_timeout = 25000');
        return await introspectPostgres(async (sql, values) => (await client.query(sql, values)).rows as Array<Record<string, unknown>>, request);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    },

    close: () => client.end(),
  };
}

function wholeResult(result: QueryResult): DriverRows {
  const columns: SqlColumnMetadata[] = (result.fields ?? []).map((field) => ({ name: field.name, type: columnType(field) }));
  let rows = result.rows as Array<Record<string, unknown>>;
  return {
    columns,
    ...(columns.length === 0 && result.rowCount != null ? { affectedRows: result.rowCount } : {}),
    async next(limit) {
      const page = rows.slice(0, limit);
      rows = rows.slice(page.length);
      return { rows: page, done: rows.length === 0 };
    },
    close: async () => undefined,
  };
}
