/** Database URLs in a project's .env files; their passwords are dropped. */

import { parseConnectionUrl, type SqlConnectionEnv } from '../../shared/sqlConnections';
import type { SqlDbImportCandidate } from '../../shared/sqlDb';

/** The .env files read at the project root, in this order. */
export const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.staging', '.env.production', '.env.test'];

// DATABASE_URL, POSTGRES_URL_NON_POOLING, HEROKU_POSTGRESQL_RED_URL, PG_URI, MYSQL_URL and the like.
const URL_KEY = /^(?:[A-Z0-9_]*_)?(?:DATABASE|DB|POSTGRES(?:QL)?|PG|MYSQL|MARIADB|SQLITE)(?:_[A-Z0-9]+)*_UR[LI](?:_[A-Z0-9]+)*$|^DIRECT_URL$/;

const envOf = (file: string): SqlConnectionEnv | undefined =>
  /production|prod\b/.test(file) ? 'prod' : /staging/.test(file) ? 'staging' : /development|local/.test(file) ? 'dev' : undefined;

function unquote(value: string): string {
  const quoted = /^(["'`])(.*)\1$/.exec(value);
  if (quoted) return quoted[2]!;
  return value.replace(/\s+#.*$/, '');
}

/** The connections `text` (one .env file named `file`) points at. `skipped` counts URL keys that are not a connection. */
export function envCandidates(text: string, file: string): { found: SqlDbImportCandidate[]; skipped: number } {
  const found: SqlDbImportCandidate[] = [];
  let skipped = 0;
  const env = envOf(file);
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !URL_KEY.test(match[1]!.toUpperCase())) continue;
    const parsed = parseConnectionUrl(unquote(match[2]!).replace(/^mariadb:/i, 'mysql:'));
    if ('error' in parsed) {
      skipped += 1;
      continue;
    }
    const { draft } = parsed;
    const origin = `${match[1]} · ${file}`;
    found.push({
      draft: { ...draft, name: draft.engine === 'sqlite' ? draft.name : `${draft.database ?? draft.host} (${match[1]})`.slice(0, 80), ...(env ? { env, readOnly: env === 'prod' } : {}) },
      origin,
    });
  }
  return { found, skipped };
}
