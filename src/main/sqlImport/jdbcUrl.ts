/** JDBC URLs as DBeaver and DataGrip store them, into a connection draft without a password. */

import { parseConnectionUrl, type SqlConnectionDraft } from '../../shared/sqlConnections';

/** jdbc:postgresql://, jdbc:mysql://, jdbc:mariadb:// or jdbc:sqlite:/path; null for other engines and other URL forms. */
export function draftFromJdbcUrl(raw: string): SqlConnectionDraft | null {
  // `;key=value` properties can carry a password and are never read.
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
  return { ...parsed.draft, passwordMode: 'keychain' };
}
