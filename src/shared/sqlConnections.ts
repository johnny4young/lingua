/**
 * Saved database connections for the desktop SQL host: the catalog model
 * main persists in userData, the URL paste parser and the strict parser
 * main runs on every renderer-supplied value. Passwords are never part of
 * a connection; they live in the secret store or in main's memory.
 */

const SQL_REMOTE_ENGINES = ['postgres', 'mysql', 'sqlite'] as const;
export type SqlRemoteEngine = (typeof SQL_REMOTE_ENGINES)[number];
/** `duckdb` is the Local engine in the renderer; the rest run in the SQL host. */
export type SqlEngineKind = 'duckdb' | SqlRemoteEngine;

export const SQL_SSL_MODES = ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'] as const;
export type SqlSslMode = (typeof SQL_SSL_MODES)[number];

export const SQL_CONNECTION_ENVS = ['dev', 'staging', 'prod'] as const;
export type SqlConnectionEnv = (typeof SQL_CONNECTION_ENVS)[number];

/** `keychain` keeps it in the secret store, `session` asks once and keeps it in main's memory. */
const SQL_PASSWORD_MODES = ['keychain', 'session', 'none'] as const;
type SqlPasswordMode = (typeof SQL_PASSWORD_MODES)[number];

interface SqlConnectionSsl {
  mode: SqlSslMode;
  caPath?: string;
  certPath?: string;
  keyPath?: string;
}

export interface SqlConnectionV1 {
  version: 1;
  id: string;
  name: string;
  engine: SqlRemoteEngine;
  /** Postgres and MySQL. */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  ssl?: SqlConnectionSsl;
  /** SQLite: absolute path of the database file. */
  path?: string;
  env?: SqlConnectionEnv;
  readOnly: boolean;
  group?: string;
  passwordMode: SqlPasswordMode;
  createdAt: string;
  updatedAt: string;
}

/** What the sheet sends to save; main assigns id and timestamps on create. */
export type SqlConnectionDraft = Omit<SqlConnectionV1, 'version' | 'id' | 'createdAt' | 'updatedAt'>;

export const DEFAULT_PORTS: Readonly<Record<Exclude<SqlRemoteEngine, 'sqlite'>, number>> = {
  postgres: 5432,
  mysql: 3306,
};

const MAX_CONNECTION_NAME = 80;
const MAX_HOST = 253;
const MAX_IDENT = 128;
const MAX_PATH = 4096;
const MAX_GROUP = 60;
const CONNECTION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Hostnames, IPv4 and bracket-free IPv6: no spaces, slashes, @ or control characters.
const HOST_RE = /^[A-Za-z0-9._:%-]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

export const isValidConnectionId = (value: unknown): value is string =>
  typeof value === 'string' && CONNECTION_ID_RE.test(value);

/** An absolute file path on any desktop platform. */
function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function text(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= max ? trimmed : null;
}

function filePath(value: unknown): string | undefined | null {
  const parsed = text(value, MAX_PATH);
  if (parsed === null || parsed === undefined) return parsed;
  // eslint-disable-next-line no-control-regex
  return isAbsoluteFilePath(parsed) && !/[\u0000-\u001f]/.test(parsed) ? parsed : null;
}

function parseSsl(value: unknown): SqlConnectionSsl | null {
  if (!isRecord(value) || !oneOf(SQL_SSL_MODES, value.mode)) return null;
  const ca = filePath(value.caPath);
  const cert = filePath(value.certPath);
  const key = filePath(value.keyPath);
  if (ca === null || cert === null || key === null) return null;
  return { mode: value.mode, ...(ca ? { caPath: ca } : {}), ...(cert ? { certPath: cert } : {}), ...(key ? { keyPath: key } : {}) };
}

/**
 * Strict parser for a draft: every field is rebuilt, so an unknown key from
 * the renderer never reaches the catalog. Returns null on any mismatch.
 */
export function parseConnectionDraft(value: unknown): SqlConnectionDraft | null {
  if (!isRecord(value) || !oneOf(SQL_REMOTE_ENGINES, value.engine)) return null;
  const name = text(value.name, MAX_CONNECTION_NAME);
  if (!name) return null;
  if (typeof value.readOnly !== 'boolean' || !oneOf(SQL_PASSWORD_MODES, value.passwordMode)) return null;
  const env = value.env === undefined ? undefined : oneOf(SQL_CONNECTION_ENVS, value.env) ? value.env : null;
  const group = text(value.group, MAX_GROUP);
  if (env === null || group === null) return null;
  const base = {
    name,
    engine: value.engine,
    readOnly: value.readOnly,
    passwordMode: value.passwordMode,
    ...(env ? { env } : {}),
    ...(group ? { group } : {}),
  };
  if (value.engine === 'sqlite') {
    const path = filePath(value.path);
    // A file has no password to keep.
    if (!path || value.passwordMode !== 'none') return null;
    return { ...base, path };
  }
  const host = text(value.host, MAX_HOST);
  if (!host || !HOST_RE.test(host)) return null;
  const port = value.port === undefined ? DEFAULT_PORTS[value.engine] : value.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const database = text(value.database, MAX_IDENT);
  const user = text(value.user, MAX_IDENT);
  if (database === null || user === null) return null;
  const ssl = value.ssl === undefined ? { mode: 'verify-full' as const } : parseSsl(value.ssl);
  if (!ssl) return null;
  return { ...base, host, port, ...(database ? { database } : {}), ...(user ? { user } : {}), ssl };
}

export function parseConnection(value: unknown): SqlConnectionV1 | null {
  if (!isRecord(value) || value.version !== 1 || !isValidConnectionId(value.id)) return null;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return null;
  const draft = parseConnectionDraft(value);
  if (!draft) return null;
  return { version: 1, id: value.id, ...draft, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export type ConnectionUrlError = 'unsupported-scheme' | 'invalid-url' | 'missing-host' | 'relative-path';

export interface ParsedConnectionUrl {
  draft: SqlConnectionDraft;
  /** Present when the URL carried one; the sheet hands it to main and forgets it. */
  password?: string;
}

const decode = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

const SSL_PARAM: Readonly<Record<string, SqlSslMode>> = {
  disable: 'disable',
  disabled: 'disable',
  allow: 'prefer',
  prefer: 'prefer',
  preferred: 'prefer',
  require: 'require',
  required: 'require',
  'verify-ca': 'verify-ca',
  verify_ca: 'verify-ca',
  'verify-full': 'verify-full',
  verify_identity: 'verify-full',
};

/**
 * The URL with its password removed, so the field that showed it can keep
 * showing the rest. Uses the same parser as `parseConnectionUrl`, so both
 * agree on where the password ends.
 */
export function withoutUrlPassword(raw: string): string {
  try {
    const url = new URL(raw.trim());
    if (!url.password) return raw;
    url.password = '';
    return url.toString();
  } catch {
    return raw;
  }
}

/** postgres://, postgresql://, mysql:// or sqlite:/absolute/path into a draft. */
export function parseConnectionUrl(raw: string): ParsedConnectionUrl | { error: ConnectionUrlError } {
  const input = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input)?.[1]?.toLowerCase();
  if (scheme === 'sqlite') {
    const path = decode(input.slice('sqlite:'.length).replace(/^\/\/(?=\/|[A-Za-z]:)/, ''));
    if (!isAbsoluteFilePath(path)) return { error: 'relative-path' };
    const name = path.split(/[\\/]/).pop() || 'SQLite';
    return { draft: { name, engine: 'sqlite', path, readOnly: false, passwordMode: 'none' } };
  }
  const engine: SqlRemoteEngine | null =
    scheme === 'postgres' || scheme === 'postgresql' ? 'postgres' : scheme === 'mysql' ? 'mysql' : null;
  if (!engine) return { error: 'unsupported-scheme' };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { error: 'invalid-url' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) return { error: 'missing-host' };
  const database = decode(url.pathname.replace(/^\//, ''));
  const user = decode(url.username);
  const password = url.password ? decode(url.password) : undefined;
  const sslParam = (url.searchParams.get('sslmode') ?? url.searchParams.get('ssl-mode') ?? '').toLowerCase();
  const sslFlag = url.searchParams.get('ssl');
  const mode = SSL_PARAM[sslParam] ?? (sslFlag === 'true' || sslFlag === '1' ? 'require' : 'verify-full');
  const draft: SqlConnectionDraft = {
    name: database || host,
    engine,
    host,
    port: url.port ? Number(url.port) : DEFAULT_PORTS[engine],
    ...(database ? { database } : {}),
    ...(user ? { user } : {}),
    ssl: { mode },
    readOnly: false,
    passwordMode: password ? 'keychain' : 'none',
  };
  return password ? { draft, password } : { draft };
}

/** Secret-store id of a connection's password; only main reads it. */
export const connectionSecretId = (connectionId: string) => `db.${connectionId}`;

/** One-line label of where a connection points, without user or password. */
export function connectionTarget(connection: Pick<SqlConnectionV1, 'engine' | 'host' | 'port' | 'database' | 'path'>): string {
  if (connection.engine === 'sqlite') return connection.path ?? '';
  const port = connection.port && connection.port !== DEFAULT_PORTS[connection.engine] ? `:${connection.port}` : '';
  return `${connection.host ?? ''}${port}${connection.database ? `/${connection.database}` : ''}`;
}
