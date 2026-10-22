/**
 * ClickHouse over its HTTP interface through `@clickhouse/client`. One agent
 * makes every socket: to the pinned address or through the tunnel, with TLS
 * on top when the connection uses it. Read-only runs with `readonly = 2`,
 * which the server enforces.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';
import { createClient, type ClickHouseClient, type ClickHouseSettings } from '@clickhouse/client';
import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import type { DriverRows, DriverSession } from './driver';
import type { HostSessionConfig } from './protocol';
import { introspectClickHouse } from './clickhouseCatalog';

const FORMAT = 'JSONCompactEachRowWithNamesAndTypes';
// Wide integers and decimals arrive as text, like the other engines.
const OUTPUT: ClickHouseSettings = { output_format_json_quote_64bit_integers: 1, output_format_json_quote_decimals: 1 };
const READ_ONLY: ClickHouseSettings = { readonly: '2' };
// A closed or cancelled result drops its HTTP request, which ends a reading query on the server.
const STOP_ON_CLOSE: ClickHouseSettings = { cancel_http_readonly_queries_on_client_close: 1 };
const KILL_TIMEOUT_MS = 5_000;
const CATALOG_TIMEOUT_S = 25;
/** Statements that answer with rows; anything else runs as a command. */
const ROWS_STATEMENT = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*(?:SELECT|WITH|SHOW|DESC|DESCRIBE|EXPLAIN|EXISTS|CHECK|\()/i;

const SCALARS: Readonly<Record<string, string>> = {
  UInt8: 'UTINYINT',
  UInt16: 'USMALLINT',
  UInt32: 'UINTEGER',
  UInt64: 'UBIGINT',
  Int8: 'TINYINT',
  Int16: 'SMALLINT',
  Int32: 'INTEGER',
  Int64: 'BIGINT',
  Float32: 'FLOAT',
  Float64: 'DOUBLE',
  Bool: 'BOOLEAN',
  String: 'VARCHAR',
  UUID: 'UUID',
  Date: 'DATE',
  Date32: 'DATE',
};

const DECIMAL_PRECISION: Readonly<Record<string, number>> = { '32': 9, '64': 18, '128': 38, '256': 76 };

/** A ClickHouse type as the names the grid knows; wrappers drop, anything else stays as ClickHouse prints it. */
export function clickhouseType(raw: string): string {
  const type = raw.trim();
  const wrapped = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(type);
  if (wrapped) return clickhouseType(wrapped[1]!);
  if (SCALARS[type]) return SCALARS[type];
  const decimal = /^Decimal\((\d+)(?:,\s*(\d+))?\)$/.exec(type);
  if (decimal) return `DECIMAL(${decimal[1]},${decimal[2] ?? 0})`;
  // Decimal32(S) and its wider kin take the scale; their precision is fixed by the width.
  const sized = /^Decimal(32|64|128|256)\((\d+)\)$/.exec(type);
  if (sized) return `DECIMAL(${DECIMAL_PRECISION[sized[1]!]},${sized[2]})`;
  if (/^(?:U?Int(?:128|256))$/.test(type)) return 'HUGEINT';
  if (/^DateTime(?:64)?(?:\(.*\))?$/.test(type)) return 'TIMESTAMP';
  if (/^(?:Fixed)?String(?:\(\d+\))?$/.test(type) || /^Enum(?:8|16)?\(/.test(type)) return 'VARCHAR';
  const array = /^Array\((.*)\)$/.exec(type);
  if (array) return `${clickhouseType(array[1]!)}[]`;
  return type;
}

interface Endpoint {
  secure: boolean;
  agent: http.Agent;
  /** The certificate the last TLS socket presented. */
  peer: () => tls.PeerCertificate | undefined;
}

function tlsOptions(config: HostSessionConfig): tls.ConnectionOptions {
  const ssl = config.ssl ?? { mode: 'verify-full' as const };
  const files: tls.ConnectionOptions = {
    ...(ssl.caPath ? { ca: readFileSync(ssl.caPath) } : {}),
    ...(ssl.certPath ? { cert: readFileSync(ssl.certPath) } : {}),
    ...(ssl.keyPath ? { key: readFileSync(ssl.keyPath) } : {}),
  };
  if (ssl.mode === 'prefer' || ssl.mode === 'require') return { ...files, rejectUnauthorized: false };
  // verify-ca checks the chain only; verify-full also checks the name.
  return ssl.mode === 'verify-ca' ? { ...files, rejectUnauthorized: true, checkServerIdentity: () => undefined } : { ...files, rejectUnauthorized: true };
}

/** An agent whose sockets go to the pinned address or through the tunnel, wrapped in TLS when `secure`. */
function endpoint(config: HostSessionConfig, secure: boolean, socket?: () => Duplex): Endpoint {
  const host = config.servername ?? config.address ?? 'localhost';
  const port = config.port ?? 8443;
  const raw = () => (socket ? socket() : net.connect({ host: config.address ?? host, port }));
  let peer: tls.PeerCertificate | undefined;
  const options = secure ? tlsOptions(config) : undefined;
  const make = (): Duplex => {
    if (!options) return raw();
    const wrapped = tls.connect({ ...options, socket: raw(), ...(net.isIP(host) ? {} : { servername: host }) });
    wrapped.once('secureConnect', () => (peer = wrapped.getPeerCertificate()));
    return wrapped;
  };
  const Base = secure ? https.Agent : http.Agent;
  const agent = new Base({ keepAlive: true, maxSockets: 4 });
  // Every request's socket comes from here, whatever the URL's host resolves to.
  (agent as unknown as { createConnection: () => Duplex }).createConnection = make;
  return { secure, agent, peer: () => peer };
}

function clientFor(config: HostSessionConfig, point: Endpoint): ClickHouseClient {
  const host = config.servername ?? config.address ?? 'localhost';
  const port = config.port ?? 8443;
  return createClient({
    url: `${point.secure ? 'https' : 'http'}://${net.isIPv6(host) ? `[${host}]` : host}:${port}`,
    username: config.user ?? 'default',
    password: config.password ?? '',
    ...(config.database ? { database: config.database } : {}),
    http_agent: point.agent,
    set_basic_auth_header: true,
    application: 'Lingua',
    request_timeout: 0x7fffffff,
    clickhouse_settings: OUTPUT,
  });
}

const isTlsMismatch = (err: unknown) => /wrong version number|EPROTO|ECONNRESET|packet length too long|socket hang up/i.test(String((err as { code?: string })?.code ?? err));

/** Reads one query's rows from the stream, a page at a time; `stop` ends the server side early. */
async function streamRows(
  stream: AsyncIterable<Array<{ json: <T>() => T }>>,
  stop: () => Promise<void>
): Promise<DriverRows> {
  const iterator = stream[Symbol.asyncIterator]();
  let buffer: unknown[][] = [];
  let done = false;
  /** The next decoded rows, or null once the stream ends. */
  const pull = async (): Promise<unknown[][] | null> => {
    const next = await iterator.next();
    if (next.done) return null;
    return next.value.map((row) => row.json<unknown[]>());
  };
  const header: unknown[][] = [];
  while (header.length < 2) {
    const rows = await pull();
    if (rows === null) break;
    header.push(...rows);
  }
  const [names = [], types = []] = header.splice(0, 2) as [string[]?, string[]?];
  buffer = header;
  const columns: SqlColumnMetadata[] = names.map((name, index) => ({ name: String(name), type: clickhouseType(String(types[index] ?? '')) }));
  return {
    columns,
    async next(limit) {
      while (buffer.length < limit && !done) {
        const rows = await pull();
        if (rows === null) done = true;
        else buffer.push(...rows);
      }
      const page = buffer.slice(0, limit);
      buffer = buffer.slice(page.length);
      return { rows: page.map((row) => Object.fromEntries(columns.map((column, index) => [column.name, row[index]]))), done: done && buffer.length === 0 };
    },
    async close() {
      if (done) return;
      done = true;
      buffer = [];
      await stop();
      await iterator.return?.().catch(() => undefined);
    },
  };
}

export async function openClickHouse(config: HostSessionConfig, socket?: () => Duplex): Promise<DriverSession> {
  let point = endpoint(config, config.ssl?.mode !== 'disable', socket);
  let client = clientFor(config, point);
  try {
    // Ping does not check the password; a tiny query does.
    await client.query({ query: 'SELECT 1', format: 'JSONEachRow' }).then((result) => result.text());
  } catch (err) {
    await client.close().catch(() => undefined);
    // prefer: fall back to plain HTTP on the same port when it does not speak TLS.
    if (config.ssl?.mode !== 'prefer' || !isTlsMismatch(err)) throw err;
    point = endpoint(config, false, socket);
    client = clientFor(config, point);
    await client.query({ query: 'SELECT 1', format: 'JSONEachRow' }).then((result) => result.text());
  }
  let current: { id: string; abort: AbortController } | null = null;

  async function kill(id: string): Promise<boolean> {
    try {
      // KILL can wait on a query blocked writing to us, so it gets a deadline of its own.
      await client.command({
        query: 'KILL QUERY WHERE query_id = {id:String} ASYNC',
        query_params: { id },
        abort_signal: AbortSignal.timeout(KILL_TIMEOUT_MS),
      } as Parameters<ClickHouseClient['command']>[0]);
      return true;
    } catch {
      return false;
    }
  }

  return {
    async version() {
      const rows = await (await client.query({ query: 'SELECT version() AS v', format: 'JSONEachRow' })).json<{ v: string }>();
      return `ClickHouse ${rows[0]?.v ?? ''}`.trim();
    },

    async run(sql, { readWrite }) {
      const guarded = config.readOnly && !readWrite;
      const settings = guarded ? { ...OUTPUT, ...READ_ONLY } : OUTPUT;
      const id = randomUUID();
      const abort = new AbortController();
      // Kept until the next run, so Cancel reaches a result still streaming its pages.
      current = { id, abort };
      if (!ROWS_STATEMENT.test(sql)) {
        const result = await client.command({ query: sql, query_id: id, clickhouse_settings: settings, abort_signal: abort.signal });
        const written = Number(result.summary?.written_rows ?? 0);
        return { columns: [], affectedRows: Number.isFinite(written) ? written : 0, next: async () => ({ rows: [], done: true }), close: async () => undefined };
      }
      const result = await client.query({ query: sql, format: FORMAT, query_id: id, clickhouse_settings: { ...settings, ...STOP_ON_CLOSE }, abort_signal: abort.signal });
      return streamRows(result.stream() as unknown as AsyncIterable<Array<{ json: <T>() => T }>>, async () => abort.abort());
    },

    async cancel() {
      const running = current;
      if (!running) return false;
      running.abort.abort();
      return kill(running.id);
    },

    async estimateRows(sql) {
      try {
        const rows = await (await client.query({ query: `EXPLAIN ESTIMATE ${sql}`, format: 'JSONEachRow', clickhouse_settings: { ...OUTPUT, ...READ_ONLY } })).json<{ rows?: string | number }>();
        const total = rows.reduce((sum, row) => sum + Number(row.rows ?? 0), 0);
        return rows.length > 0 && Number.isFinite(total) ? total : null;
      } catch {
        return null;
      }
    },

    tls() {
      const cert = point.peer();
      if (!cert || !cert.subject) return undefined;
      return { ...(cert.subject.CN ? { subject: String(cert.subject.CN) } : {}), ...(cert.valid_to ? { validTo: cert.valid_to } : {}) };
    },

    introspect: (request) =>
      introspectClickHouse(async (sql, values) => {
        const params = Object.fromEntries(values.map((value, index) => [`p${index + 1}`, value]));
        const result = await client.query({
          query: sql,
          format: 'JSONEachRow',
          query_params: params,
          clickhouse_settings: { ...OUTPUT, ...READ_ONLY, max_execution_time: CATALOG_TIMEOUT_S },
        });
        return result.json<Record<string, unknown>>();
      }, request),

    async applyEdits() {
      throw new Error('ClickHouse tables are not edited row by row.');
    },

    close: async () => {
      await client.close().catch(() => undefined);
      point.agent.destroy();
    },
  };
}
