/**
 * TablePlus' Connections.plist. Its passwords live in the macOS keychain,
 * which Lingua never reads; only the fields mapped below are used.
 */

import path from 'node:path';
import { DEFAULT_PORTS, type SqlConnectionDraft, type SqlConnectionEnv, type SqlSslMode } from '../../shared/sqlConnections';
import type { SqlDbImportCandidate } from '../../shared/sqlDb';
import { parsePlist, type PlistValue } from './plist';

type Dict = { [key: string]: PlistValue };

const isDict = (value: PlistValue | undefined): value is Dict => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value: PlistValue | undefined) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const flag = (value: PlistValue | undefined) => value === true || value === 1;

const ENGINE: Readonly<Record<string, SqlConnectionDraft['engine']>> = { postgresql: 'postgres', mysql: 'mysql', mariadb: 'mysql', sqlite: 'sqlite' };

const ENV: Readonly<Record<string, SqlConnectionEnv>> = { local: 'dev', development: 'dev', testing: 'staging', staging: 'staging', production: 'prod' };

/** tLSMode is an index into each driver's SSL list in TablePlus. */
const TLS: Readonly<Record<string, readonly SqlSslMode[]>> = {
  postgresql: ['prefer', 'disable', 'require', 'prefer', 'verify-ca', 'verify-full'],
  mysql: ['prefer', 'disable', 'require', 'verify-ca', 'verify-full'],
  mariadb: ['prefer', 'require', 'verify-full'],
};

const PASSWORD_NONE = 2;

/** `~/x`, an absolute path, or a bare name TablePlus looks for in ~/.ssh. */
function keyPath(name: string | undefined, home: string): string | undefined {
  if (!name) return undefined;
  if (name.startsWith('~/')) return path.join(home, name.slice(2));
  if (path.isAbsolute(name)) return name;
  return name.includes('/') ? undefined : path.join(home, '.ssh', name);
}

function sslOf(entry: Dict, driver: string): SqlConnectionDraft['ssl'] {
  const index = typeof entry.tLSMode === 'number' ? entry.tLSMode : 0;
  const mode = TLS[driver]?.[index] ?? 'prefer';
  // TlsKeyPaths is ordered as TlsKeyName says: client key, client certificate, CA.
  const paths = Array.isArray(entry.TlsKeyPaths) ? entry.TlsKeyPaths.map((value) => (typeof value === 'string' && path.isAbsolute(value) ? value : undefined)) : [];
  return { mode, ...(paths[2] ? { caPath: paths[2] } : {}), ...(paths[1] ? { certPath: paths[1] } : {}), ...(paths[0] ? { keyPath: paths[0] } : {}) };
}

function sshOf(entry: Dict, home: string): SqlConnectionDraft['ssh'] | null | undefined {
  if (!flag(entry.isOverSSH)) return undefined;
  const host = str(entry.ServerAddress);
  const user = str(entry.ServerUser);
  if (!host || !user) return null;
  const port = Number(str(entry.ServerPort) ?? 22);
  if (flag(entry.isUsePrivateKey)) {
    const file = keyPath(str(entry.ServerPrivateKeyName), home);
    return file ? { host, port, user, auth: 'key', keyPath: file, secretMode: 'none' } : null;
  }
  return { host, port, user, auth: 'password', secretMode: entry.ServerPasswordMode === PASSWORD_NONE ? 'none' : 'keychain' };
}

/** Group names by id from ConnectionGroups.plist, when it sits next to the connections. */
function groupNames(groups: Buffer | null): Map<string, string> {
  const parsed = groups ? parsePlist(groups) : undefined;
  const names = new Map<string, string>();
  if (Array.isArray(parsed)) for (const group of parsed) if (isDict(group) && str(group.ID) && str(group.Name)) names.set(str(group.ID)!, str(group.Name)!);
  return names;
}

/** The connections a Connections.plist lists; null when the data is not one. */
export function tablePlusCandidates(data: Buffer, groups: Buffer | null, home: string): { found: SqlDbImportCandidate[]; skipped: number } | null {
  const parsed = parsePlist(data);
  if (!Array.isArray(parsed) || !parsed.every(isDict) || !parsed.every((entry) => 'ConnectionName' in entry || 'Driver' in entry)) return null;
  const names = groupNames(groups);
  const found: SqlDbImportCandidate[] = [];
  let skipped = 0;
  for (const entry of parsed) {
    const driver = str(entry.Driver)?.toLowerCase() ?? '';
    const engine = ENGINE[driver];
    const name = str(entry.ConnectionName)?.slice(0, 80);
    const env = ENV[str(entry.Enviroment)?.toLowerCase() ?? ''];
    const group = names.get(str(entry.GroupID) ?? '')?.slice(0, 60);
    const base = { name: name ?? '', readOnly: env === 'prod', ...(env ? { env } : {}), ...(group ? { group } : {}) };
    let draft: SqlConnectionDraft | null = null;
    if (engine === 'sqlite') {
      const file = str(entry.DatabasePath);
      draft = file && path.isAbsolute(file) ? { ...base, engine, path: file, passwordMode: 'none' } : null;
    } else if (engine) {
      const host = str(entry.DatabaseHost);
      const ssh = sshOf(entry, home);
      const port = Number(str(entry.DatabasePort) ?? DEFAULT_PORTS[engine]);
      draft =
        host && ssh !== null
          ? {
              ...base,
              engine,
              host,
              port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORTS[engine],
              ...(str(entry.DatabaseName) ? { database: str(entry.DatabaseName) } : {}),
              ...(str(entry.DatabaseUser) ? { user: str(entry.DatabaseUser) } : {}),
              ssl: sslOf(entry, driver),
              passwordMode: entry.DatabasePasswordMode === PASSWORD_NONE ? 'none' : 'keychain',
              ...(ssh ? { ssh } : {}),
            }
          : null;
    }
    if (!draft || !draft.name) {
      skipped += 1;
      continue;
    }
    found.push({ draft });
  }
  return { found, skipped };
}
