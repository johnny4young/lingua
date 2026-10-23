/**
 * DBeaver's data-sources.json. Credentials live in credentials-config.json,
 * which Lingua never opens; a user name shows only when DBeaver kept it here.
 */

import { clientDefaultPort, type SqlConnectionDraft, type SqlConnectionEnv, type SqlSslMode } from '../../shared/sqlConnections';
import type { SqlDbImportCandidate } from '../../shared/sqlDb';
import { MAX_IMPORT_CONNECTIONS } from './limits';
import { draftFromJdbcUrl } from './jdbcUrl';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// DBeaver variables (${host}) are resolved by DBeaver at connect time; such a value is left out.
const str = (value: unknown) => (typeof value === 'string' && value.trim() && !value.includes('${') ? value.trim() : undefined);
const num = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : undefined;
};

const ENGINE: Readonly<Record<string, SqlConnectionDraft['engine']>> = {
  postgresql: 'postgres',
  postgres: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  sqlite: 'sqlite',
  sqlserver: 'sqlserver',
  mssql: 'sqlserver',
  clickhouse: 'clickhouse',
};

const ENV: Readonly<Record<string, SqlConnectionEnv>> = { dev: 'dev', test: 'staging', prod: 'prod' };

function engineOf(connection: Json): SqlConnectionDraft['engine'] | undefined {
  for (const field of [connection.provider, connection.driver]) {
    const value = str(field)?.toLowerCase() ?? '';
    const match = Object.keys(ENGINE).find((key) => value.startsWith(key) || value.includes(key));
    if (match) return ENGINE[match];
  }
  return undefined;
}

const handler = (configuration: Json, id: string) => {
  const value = isRecord(configuration.handlers) ? configuration.handlers[id] : undefined;
  return isRecord(value) && value.enabled === true && isRecord(value.properties) ? (value as Json & { properties: Json }) : undefined;
};

/** The user DBeaver kept in plain text, if any; passwords next to it are never read. */
const userOf = (record: Json) => str(record.user) ?? (isRecord(record.credentials) ? str(record.credentials.user) : undefined);

/** Undefined without a tunnel, null for one Lingua cannot rebuild (its user sits in DBeaver's encrypted credentials). */
function sshOf(configuration: Json): SqlConnectionDraft['ssh'] | null | undefined {
  const tunnel = handler(configuration, 'ssh_tunnel');
  if (!tunnel) return undefined;
  const props = tunnel.properties;
  const host = str(props.host);
  const user = userOf(tunnel) ?? str(props.user);
  if (!host || !user) return null;
  const authType = str(props.authType)?.toUpperCase();
  const keyPath = str(props.keyPath);
  const auth = authType === 'PUBLIC_KEY' && keyPath ? 'key' : authType === 'AGENT' ? 'agent' : 'password';
  return { host, port: num(props.port) ?? 22, user, auth, ...(auth === 'key' ? { keyPath } : {}), secretMode: auth === 'password' ? 'keychain' : 'none' };
}

const PG_SSL: Readonly<Record<string, SqlSslMode>> = { disable: 'disable', allow: 'prefer', prefer: 'prefer', require: 'require', 'verify-ca': 'verify-ca', 'verify-full': 'verify-full' };

/** The SSL handler's mode and files; prefer without one, as the drivers default to. */
function sslOf(configuration: Json, engine: Exclude<SqlConnectionDraft['engine'], 'sqlite'>): NonNullable<SqlConnectionDraft['ssl']> {
  // SQL Server and ClickHouse keep their TLS switches in driver properties, which are not read.
  const ssl = engine === 'postgres' || engine === 'mysql' ? handler(configuration, engine === 'postgres' ? 'postgre_ssl' : 'mysql_ssl') : undefined;
  if (!ssl) return { mode: 'prefer' };
  const props = ssl.properties;
  const mode: SqlSslMode =
    engine === 'postgres' ? (PG_SSL[str(props.sslMode)?.toLowerCase() ?? ''] ?? 'require') : props['ssl.verify.server'] === true || props['ssl.verify.server'] === 'true' ? 'verify-full' : 'require';
  const file = (...keys: string[]) => keys.map((key) => str(props[key])).find((value) => value && /^(?:\/|[A-Za-z]:[\\/])/.test(value));
  const caPath = file('ssl.ca.cert', 'rootCert');
  const certPath = file('ssl.client.cert', 'clientCert');
  const keyPath = file('ssl.client.key', 'clientKey');
  return { mode, ...(caPath ? { caPath } : {}), ...(certPath ? { certPath } : {}), ...(keyPath ? { keyPath } : {}) };
}

/** The connections a data-sources.json lists; null when the text is not one. */
export function dbeaverCandidates(text: string): { found: SqlDbImportCandidate[]; skipped: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.connections)) return null;
  const found: SqlDbImportCandidate[] = [];
  let skipped = 0;
  for (const value of Object.values(raw.connections)) {
    if (!isRecord(value) || !isRecord(value.configuration)) {
      skipped += 1;
      continue;
    }
    const configuration = value.configuration;
    const engine = engineOf(value);
    const name = (str(value.name) ?? '').slice(0, 80);
    const group = str(value.folder)?.slice(0, 60);
    const env = ENV[str(configuration.type)?.toLowerCase() ?? ''];
    const readOnly = value['read-only'] === true || configuration['read-only'] === true || env === 'prod';
    const base = { name, readOnly, ...(group ? { group } : {}), ...(env ? { env } : {}) };
    let draft: SqlConnectionDraft | null = null;
    if (engine === 'sqlite') {
      const path = str(configuration.database) ?? str(configuration.url)?.replace(/^jdbc:sqlite:/i, '');
      draft = path && /^(?:\/|[A-Za-z]:[\\/])/.test(path) ? { ...base, engine, path, passwordMode: 'none' } : null;
    } else if (engine) {
      const host = str(configuration.host);
      const fromUrl = !host && str(configuration.url) ? draftFromJdbcUrl(str(configuration.url)!) : null;
      const user = userOf(configuration);
      const ssh = sshOf(configuration);
      draft =
        ssh === null
          ? null
          : host
            ? {
                ...base,
                engine,
                host,
                port: num(configuration.port) ?? clientDefaultPort(engine),
                ...(str(configuration.database) ? { database: str(configuration.database) } : {}),
                ...(user ? { user } : {}),
                ssl: sslOf(configuration, engine),
                passwordMode: 'keychain',
              }
            : fromUrl && fromUrl.engine === engine
              ? { ...fromUrl, ...base, ...(user ? { user } : {}), ssl: sslOf(configuration, engine) }
              : null;
      if (draft && ssh) draft = { ...draft, ssh };
    }
    if (!draft || !draft.name || found.length >= MAX_IMPORT_CONNECTIONS) {
      skipped += 1;
      continue;
    }
    found.push({ draft });
  }
  return { found, skipped };
}
