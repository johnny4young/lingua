/**
 * Saved database connections for the desktop SQL host: the catalog model
 * main persists in userData, the URL paste parser and the strict parser
 * main runs on every renderer-supplied value. Passwords are never part of
 * a connection; they live in the secret store or in main's memory.
 */

const SQL_REMOTE_ENGINES = ['postgres', 'mysql', 'sqlite', 'sqlserver', 'clickhouse'] as const;
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

export const SQL_SSH_AUTHS = ['password', 'key', 'agent'] as const;
export type SqlSshAuth = (typeof SQL_SSH_AUTHS)[number];

export interface SqlSshHop {
  host: string;
  port: number;
  user: string;
}

/** The bastion in front of the database, reached through `jumps` in order. */
export interface SqlConnectionSsh extends SqlSshHop {
  auth: SqlSshAuth;
  /** Private key file, for `key`: inside ~/.ssh or outside the protected folders. */
  keyPath?: string;
  /** Where the SSH password or key passphrase is kept; `none` for the agent or a key without one. */
  secretMode: SqlPasswordMode;
  /** Hops before the bastion; each signs in with the same key or agent. */
  jumps?: SqlSshHop[];
}

export const MAX_SSH_JUMPS = 3;

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
  /** Every engine but SQLite. */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  ssl?: SqlConnectionSsl;
  /** SQLite: absolute path of the database file. */
  path?: string;
  /** A server engine through an SSH tunnel; the database host is resolved by the bastion. */
  ssh?: SqlConnectionSsh;
  env?: SqlConnectionEnv;
  readOnly: boolean;
  /** Every write asks for the typed connection name, as production does. */
  confirmWrites?: boolean;
  /** False refuses a private or loopback address (the first SSH hop when tunnelled). Absent means allowed. */
  allowPrivateHost?: boolean;
  group?: string;
  passwordMode: SqlPasswordMode;
  createdAt: string;
  updatedAt: string;
}

/** What the sheet sends to save; main assigns id and timestamps on create. */
export type SqlConnectionDraft = Omit<SqlConnectionV1, 'version' | 'id' | 'createdAt' | 'updatedAt'>;

const DEFAULT_PORTS: Readonly<Record<Exclude<SqlRemoteEngine, 'sqlite'>, number>> = {
  postgres: 5432,
  mysql: 3306,
  sqlserver: 1433,
  // ClickHouse's HTTPS interface; its plain HTTP one listens on 8123.
  clickhouse: 8443,
};

/** ClickHouse's plain HTTP port, the default when TLS is off. */
const CLICKHOUSE_HTTP_PORT = 8123;

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

export const isSqlRemoteEngine = (value: unknown): value is SqlRemoteEngine => oneOf(SQL_REMOTE_ENGINES, value);

export const isValidConnectionId = (value: unknown): value is string =>
  typeof value === 'string' && CONNECTION_ID_RE.test(value);

/** An absolute file path on any desktop platform. */
/** A local absolute path; network shares and device paths (`\\server\share`, `\\?\`, `//host/share`) are refused. */
function isAbsoluteFilePath(value: string): boolean {
  if (/^[\\/]{2}/.test(value)) return false;
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
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

function parseHop(value: unknown): SqlSshHop | null {
  if (!isRecord(value)) return null;
  const host = text(value.host, MAX_HOST);
  const user = text(value.user, MAX_IDENT);
  const port = value.port === undefined ? 22 : value.port;
  if (!host || !HOST_RE.test(host) || !user) return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host, port, user };
}

function parseSsh(value: unknown): SqlConnectionSsh | null {
  if (!isRecord(value) || !oneOf(SQL_SSH_AUTHS, value.auth) || !oneOf(SQL_PASSWORD_MODES, value.secretMode)) return null;
  const hop = parseHop(value);
  const keyPath = filePath(value.keyPath);
  if (!hop || keyPath === null) return null;
  const { auth, secretMode } = value;
  if (auth === 'key' && !keyPath) return null;
  if (auth === 'password' && secretMode === 'none') return null;
  if (auth === 'agent' && secretMode !== 'none') return null;
  let jumps: SqlSshHop[] | undefined;
  if (value.jumps !== undefined) {
    if (!Array.isArray(value.jumps) || value.jumps.length > MAX_SSH_JUMPS) return null;
    const parsed = value.jumps.map(parseHop);
    // A password belongs to one host; jumps sign in with the key or the agent.
    if (parsed.some((jump) => jump === null) || (parsed.length > 0 && auth === 'password')) return null;
    if (parsed.length > 0) jumps = parsed as SqlSshHop[];
  }
  return { ...hop, auth, secretMode, ...(auth === 'key' ? { keyPath: keyPath! } : {}), ...(jumps ? { jumps } : {}) };
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
  const flag = (field: unknown) => (field === undefined ? undefined : typeof field === 'boolean' ? field : null);
  const confirmWrites = flag(value.confirmWrites);
  const allowPrivateHost = flag(value.allowPrivateHost);
  if (confirmWrites === null || allowPrivateHost === null) return null;
  const base = {
    name,
    engine: value.engine,
    readOnly: value.readOnly,
    passwordMode: value.passwordMode,
    ...(env ? { env } : {}),
    ...(group ? { group } : {}),
    ...(confirmWrites ? { confirmWrites } : {}),
    ...(allowPrivateHost === false ? { allowPrivateHost } : {}),
  };
  if (value.engine === 'sqlite') {
    const path = filePath(value.path);
    // A file has no password to keep.
    if (!path || value.passwordMode !== 'none') return null;
    return { ...base, path };
  }
  const host = text(value.host, MAX_HOST);
  if (!host || !HOST_RE.test(host)) return null;
  const ssl = value.ssl === undefined ? { mode: 'verify-full' as const } : parseSsl(value.ssl);
  if (!ssl) return null;
  const port = value.port === undefined ? defaultPort(value.engine, ssl.mode) : value.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const database = text(value.database, MAX_IDENT);
  const user = text(value.user, MAX_IDENT);
  if (database === null || user === null) return null;
  const ssh = value.ssh === undefined ? undefined : parseSsh(value.ssh);
  if (ssh === null) return null;
  return { ...base, host, port, ...(database ? { database } : {}), ...(user ? { user } : {}), ssl, ...(ssh ? { ssh } : {}) };
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
  // SQL Server's `;password=` properties are not part of a URL's user info.
  if (/^\s*(sqlserver|mssql):\/\/[^;]*;/i.test(raw)) {
    const split = splitSqlServerProperties(raw.slice(raw.indexOf('://') + 3));
    const head = raw.slice(0, raw.indexOf('://') + 3);
    // A value that never closes cannot be told apart from the password, so nothing after the host is kept.
    if (!split) return `${head}${raw.slice(raw.indexOf('://') + 3).split(';')[0]}`;
    const kept = split.pairs.filter(({ key }) => !PASSWORD_KEYS.has(key)).map(({ raw: text }) => text);
    return `${head}${[split.authority, ...kept].join(';')}`;
  }
  try {
    const url = new URL(raw.trim());
    if (!url.password) return raw;
    url.password = '';
    return url.toString();
  } catch {
    return raw;
  }
}

const URL_ENGINES: Readonly<Record<string, Exclude<SqlRemoteEngine, 'sqlite'>>> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  sqlserver: 'sqlserver',
  mssql: 'sqlserver',
  clickhouse: 'clickhouse',
};

/** SQL Server's encrypt and trustServerCertificate switches as an SSL mode; absent means verify. */
function sqlServerSsl(encrypt: string | undefined, trust: string | undefined): SqlSslMode {
  if (encrypt === 'false' || encrypt === 'no') return 'disable';
  return trust === 'true' || trust === 'yes' ? 'require' : 'verify-full';
}

/** `sqlserver://host:port;database=db;user=u;password=p;encrypt=true`, the form Prisma and many .env files use. */
const PASSWORD_KEYS: ReadonlySet<string> = new Set(['password', 'pwd']);

/**
 * `host:port;key=value;…` with Prisma's `{…}` values, where a brace keeps `;`
 * inside and `}}` stands for `}`; null when a brace never closes.
 */
function splitSqlServerProperties(rest: string): { authority: string; pairs: Array<{ key: string; value: string; raw: string }> } | null {
  const first = rest.indexOf(';');
  const authority = first < 0 ? rest : rest.slice(0, first);
  const pairs: Array<{ key: string; value: string; raw: string }> = [];
  let i = first < 0 ? rest.length : first + 1;
  while (i < rest.length) {
    const start = i;
    const equals = rest.indexOf('=', i);
    const semi = rest.indexOf(';', i);
    if (equals < 0 || (semi >= 0 && semi < equals)) {
      i = semi < 0 ? rest.length : semi + 1;
      continue;
    }
    const key = rest.slice(i, equals).trim().toLowerCase();
    let j = equals + 1;
    while (rest[j] === ' ') j += 1;
    let value = '';
    if (rest[j] === '{') {
      j += 1;
      for (;;) {
        const close = rest.indexOf('}', j);
        if (close < 0) return null;
        value += rest.slice(j, close);
        if (rest[close + 1] === '}') {
          value += '}';
          j = close + 2;
        } else {
          j = close + 1;
          break;
        }
      }
      const end = rest.indexOf(';', j);
      i = end < 0 ? rest.length : end + 1;
      pairs.push({ key, value, raw: rest.slice(start, end < 0 ? rest.length : end) });
    } else {
      const end = rest.indexOf(';', j);
      value = rest.slice(j, end < 0 ? rest.length : end).trim();
      i = end < 0 ? rest.length : end + 1;
      pairs.push({ key, value, raw: rest.slice(start, end < 0 ? rest.length : end) });
    }
  }
  return { authority, pairs };
}

function parseSqlServerProperties(input: string): ParsedConnectionUrl | { error: ConnectionUrlError } {
  const split = splitSqlServerProperties(input.slice(input.indexOf('://') + 3));
  if (!split) return { error: 'invalid-url' };
  const authority = split.authority;
  const props = new Map(split.pairs.map(({ key, value }) => [key, value]));
  const match = /^(\[[^\]]+\]|[^:/\\]+)(?::(\d+))?(?:\\.*)?$/.exec(authority.trim());
  if (!match) return { error: authority.trim() ? 'invalid-url' : 'missing-host' };
  const host = match[1]!.replace(/^\[|\]$/g, '');
  const database = props.get('database') ?? props.get('initial catalog');
  const user = props.get('user') ?? props.get('username') ?? props.get('user id') ?? props.get('uid');
  const password = props.get('password') ?? props.get('pwd');
  const draft: SqlConnectionDraft = {
    name: database || host,
    engine: 'sqlserver',
    host,
    port: match[2] ? Number(match[2]) : DEFAULT_PORTS.sqlserver,
    ...(database ? { database } : {}),
    ...(user ? { user } : {}),
    ssl: { mode: sqlServerSsl(props.get('encrypt')?.toLowerCase(), props.get('trustservercertificate')?.toLowerCase()) },
    readOnly: false,
    passwordMode: password ? 'keychain' : 'none',
  };
  return password ? { draft, password } : { draft };
}

/** postgres://, mysql://, sqlserver:// or mssql://, clickhouse:// or sqlite:/absolute/path into a draft. */
export function parseConnectionUrl(raw: string): ParsedConnectionUrl | { error: ConnectionUrlError } {
  const input = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input)?.[1]?.toLowerCase();
  if (scheme === 'sqlite') {
    const path = decode(input.slice('sqlite:'.length).replace(/^\/\/(?=\/|[A-Za-z]:)/, ''));
    if (!isAbsoluteFilePath(path)) return { error: 'relative-path' };
    const name = path.split(/[\\/]/).pop() || 'SQLite';
    return { draft: { name, engine: 'sqlite', path, readOnly: false, passwordMode: 'none' } };
  }
  const engine = scheme ? URL_ENGINES[scheme] : undefined;
  if (!engine) return { error: 'unsupported-scheme' };
  if (engine === 'sqlserver' && input.includes(';')) return parseSqlServerProperties(input);
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
  const sslFlag = (url.searchParams.get('ssl') ?? url.searchParams.get('secure'))?.toLowerCase();
  // ClickHouse's 8123 is its plain HTTP port, so a URL naming it without an SSL hint means no TLS.
  const plainClickhouse = engine === 'clickhouse' && url.port === String(CLICKHOUSE_HTTP_PORT);
  const mode =
    engine === 'sqlserver' && url.searchParams.has('encrypt')
      ? sqlServerSsl(url.searchParams.get('encrypt')?.toLowerCase(), url.searchParams.get('trustServerCertificate')?.toLowerCase())
      : (SSL_PARAM[sslParam] ??
        (sslFlag === 'true' || sslFlag === '1' ? 'require' : sslFlag === 'false' || sslFlag === '0' || (sslFlag === undefined && plainClickhouse) ? 'disable' : 'verify-full'));
  const draft: SqlConnectionDraft = {
    name: database || host,
    engine,
    host,
    port: url.port ? Number(url.port) : defaultPort(engine, mode),
    ...(database ? { database } : {}),
    ...(user ? { user } : {}),
    ssl: { mode },
    readOnly: false,
    passwordMode: password ? 'keychain' : 'none',
  };
  return password ? { draft, password } : { draft };
}

/** The port an engine listens on by default; ClickHouse's depends on TLS. */
export const defaultPort = (engine: Exclude<SqlRemoteEngine, 'sqlite'>, sslMode: SqlSslMode = 'verify-full'): number =>
  engine === 'clickhouse' && sslMode === 'disable' ? CLICKHOUSE_HTTP_PORT : DEFAULT_PORTS[engine];

/** The port a client such as DBeaver or TablePlus assumes when it stores none; they reach ClickHouse over plain HTTP. */
export const clientDefaultPort = (engine: Exclude<SqlRemoteEngine, 'sqlite'>): number => defaultPort(engine, engine === 'clickhouse' ? 'disable' : 'verify-full');

const sameHops = (a: SqlSshHop[] = [], b: SqlSshHop[] = []) =>
  a.length === b.length && a.every((hop, index) => hop.host === b[index]!.host && hop.port === b[index]!.port && hop.user === b[index]!.user);

/** The tunnel a saved SSH secret belongs to; another bastion, user, key or jump chain must be given it again. */
export function sameSshTarget(a: SqlConnectionDraft['ssh'], b: SqlConnectionDraft['ssh']): boolean {
  if (!a || !b) return !a && !b;
  return a.host === b.host && a.port === b.port && a.user === b.user && a.auth === b.auth && a.keyPath === b.keyPath && sameHops(a.jumps, b.jumps);
}

/** Secret-store id of a connection's password; only main reads it. */
export const connectionSecretId = (connectionId: string) => `db.${connectionId}`;

/** One-line label of where a connection points, without user or password. */
export function connectionTarget(connection: Pick<SqlConnectionV1, 'engine' | 'host' | 'port' | 'database' | 'path'>): string {
  if (connection.engine === 'sqlite') return connection.path ?? '';
  const port = connection.port && connection.port !== DEFAULT_PORTS[connection.engine] ? `:${connection.port}` : '';
  return `${connection.host ?? ''}${port}${connection.database ? `/${connection.database}` : ''}`;
}
