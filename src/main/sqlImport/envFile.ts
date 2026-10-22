/** Database URLs in a project's .env files; their passwords are dropped. */

import { parseConnectionUrl, type SqlConnectionEnv } from '../../shared/sqlConnections';
import type { SqlDbImportCandidate } from '../../shared/sqlDb';
import { MAX_IMPORT_CONNECTIONS } from './limits';

/** The .env files read at the project root, in this order. */
export const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.staging', '.env.production', '.env.test'];

const MAX_LINE = 4096;
const MAX_KEY = 128;
const ENGINE_WORDS = new Set(['DATABASE', 'DB', 'POSTGRES', 'POSTGRESQL', 'PG', 'MYSQL', 'MARIADB', 'SQLITE']);

/** DATABASE_URL, POSTGRES_URL_NON_POOLING, HEROKU_POSTGRESQL_RED_URL, PG_URI and the like, plus Prisma's DIRECT_URL. */
function isDatabaseUrlKey(key: string): boolean {
  if (key === 'DIRECT_URL') return true;
  const words = key.split('_');
  const engine = words.findIndex((word) => ENGINE_WORDS.has(word));
  return engine >= 0 && words.slice(engine + 1).some((word) => word === 'URL' || word === 'URI');
}

const envOf = (file: string): SqlConnectionEnv | undefined =>
  file.includes('production') ? 'prod' : file.includes('staging') ? 'staging' : file.includes('development') || file.includes('local') ? 'dev' : undefined;

/** The value without its quotes or a trailing comment. */
function valueOf(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'" || quote === '`') && value.length > 1) {
    const end = value.indexOf(quote, 1);
    return end > 0 ? value.slice(1, end) : value.slice(1);
  }
  const comment = value.search(/\s#/);
  return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

/** The connections `text` (one .env file named `file`) points at. `skipped` counts URL keys that are not a connection. */
export function envCandidates(text: string, file: string): { found: SqlDbImportCandidate[]; skipped: number } {
  const found: SqlDbImportCandidate[] = [];
  let skipped = 0;
  const env = envOf(file);
  for (const line of text.split('\n')) {
    if (line.length > MAX_LINE) continue;
    const equals = line.indexOf('=');
    if (equals < 0) continue;
    const key = line.slice(0, equals).trim().replace(/^export\s+/, '');
    if (key.length > MAX_KEY || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !isDatabaseUrlKey(key.toUpperCase())) continue;
    const parsed = parseConnectionUrl(valueOf(line.slice(equals + 1)).replace(/^mariadb:/i, 'mysql:'));
    if ('error' in parsed || found.length >= MAX_IMPORT_CONNECTIONS) {
      skipped += 1;
      continue;
    }
    const { draft } = parsed;
    found.push({
      draft: { ...draft, name: draft.engine === 'sqlite' ? draft.name : `${draft.database ?? draft.host} (${key})`.slice(0, 80), ...(env ? { env, readOnly: env === 'prod' } : {}) },
      origin: `${key} · ${file}`,
    });
  }
  return { found, skipped };
}
