/** JDBC URLs as DBeaver and DataGrip store them, into a connection draft without a password. */

import { parseConnectionUrl, type SqlConnectionDraft } from '../../shared/sqlConnections';

/** jdbc:postgresql://, jdbc:mysql://, jdbc:mariadb:// or jdbc:sqlite:/path; null for other engines. */
export function draftFromJdbcUrl(raw: string): SqlConnectionDraft | null {
  const url = raw.trim().replace(/^jdbc:/i, '');
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
  return 'error' in parsed ? null : { ...parsed.draft, passwordMode: 'keychain' };
}
