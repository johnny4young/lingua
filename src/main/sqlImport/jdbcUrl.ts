/** JDBC URLs as DBeaver and DataGrip store them, into a connection draft without a password. */

import { parseConnectionUrl, type SqlConnectionDraft } from '../../shared/sqlConnections';

/** SQL Server's database from its `;databaseName=` property; no other property is read. */
function sqlServerDatabase(raw: string): string | undefined {
  const match = /;\s*(?:databaseName|database)\s*=\s*([^;]+)/i.exec(raw);
  return match?.[1]?.trim() || undefined;
}

/** jdbc:postgresql://, jdbc:mysql://, jdbc:mariadb://, jdbc:sqlserver://, jdbc:clickhouse:// or jdbc:sqlite:/path; null for other engines and URL forms. */
export function draftFromJdbcUrl(raw: string): SqlConnectionDraft | null {
  // `;key=value` properties can carry a password; only SQL Server's database name is read from them.
  const url = raw.trim().replace(/^jdbc:/i, '').split(';')[0]!;
  const scheme = /^([a-z0-9]+):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === 'sqlite') {
    const path = url.slice('sqlite:'.length).replace(/^file:/i, '').split('?')[0]!;
    const parsed = parseConnectionUrl(`sqlite:${path}`);
    return 'error' in parsed ? null : parsed.draft;
  }
  const normalized = scheme === 'postgresql' ? `postgres:${url.slice(scheme.length + 1)}` : scheme === 'mariadb' ? `mysql:${url.slice(scheme.length + 1)}` : url;
  // Several hosts (replicas, failover) keep the first.
  const firstHost = normalized.replace(/^([a-z]+:\/\/[^/,?]+),[^/?]*/i, '$1');
  const parsed = parseConnectionUrl(firstHost);
  if ('error' in parsed) return null;
  // Connector/J's address=(host=…)(password=…) form and other parenthesised hosts are not a plain host.
  if (/[()=]/.test(`${parsed.draft.host}${parsed.draft.database ?? ''}`)) return null;
  const database = parsed.draft.engine === 'sqlserver' && !parsed.draft.database ? sqlServerDatabase(raw) : undefined;
  return { ...parsed.draft, ...(database ? { database, name: parsed.draft.name === parsed.draft.host ? database : parsed.draft.name } : {}), passwordMode: 'keychain' };
}
