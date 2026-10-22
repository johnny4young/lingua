/** Grouping, search and import rules of the connection manager, kept apart from its markup. */

import { parseConnectionDraft, type SqlConnectionDraft } from '../../../shared/sqlConnections';
import type { SqlDbConnectionView, SqlDbImportCandidate } from '../../../shared/sqlDb';
import { ENGINE_LABEL } from './sqlConnectionStyle';

export interface SqlConnectionGroup {
  /** Undefined for connections with no group, listed last. */
  name: string | undefined;
  connections: SqlDbConnectionView[];
}

/** Where a connection points, for the row and for search: host:port/database, or the file name. */
export function connectionWhere(connection: Pick<SqlConnectionDraft, 'engine' | 'host' | 'port' | 'database' | 'path'>): string {
  if (connection.engine === 'sqlite') return connection.path?.split(/[\\/]/).pop() ?? '';
  return `${connection.host ?? ''}${connection.port ? `:${connection.port}` : ''}${connection.database ? `/${connection.database}` : ''}`;
}

/** Saved connections matching `query` by name, host, database, group, environment or engine, grouped by name. */
export function groupConnections(connections: ReadonlyArray<SqlDbConnectionView>, query: string): SqlConnectionGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (connection: SqlDbConnectionView) => {
    const haystack = [connection.name, connection.host, connection.database, connection.path, connection.group, connection.env, ENGINE_LABEL[connection.engine]]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  const groups = new Map<string | undefined, SqlDbConnectionView[]>();
  for (const connection of connections) {
    if (!matches(connection)) continue;
    const list = groups.get(connection.group) ?? [];
    list.push(connection);
    groups.set(connection.group, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === undefined ? 1 : b === undefined ? -1 : a.localeCompare(b)))
    .map(([name, list]) => ({ name, connections: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** The same database the same way: engine, host, port, database and user, or the same file. */
const sameDatabase = (a: SqlConnectionDraft, b: SqlConnectionDraft) =>
  a.engine === b.engine &&
  (a.engine === 'sqlite' ? a.path === b.path : a.host?.toLowerCase() === b.host?.toLowerCase() && a.port === b.port && a.database === b.database && a.user === b.user);

/** Whether an import points at a connection that is already saved. */
export const isAlreadySaved = (candidate: SqlDbImportCandidate, saved: ReadonlyArray<SqlConnectionDraft>) => saved.some((entry) => sameDatabase(entry, candidate.draft));

export type SqlImportPasswordMode = 'keychain' | 'session';

/**
 * The draft an import saves: a connection that signs in with a password keeps
 * it as the user chose, and nothing copies a password from the other client.
 * Without a keychain, the secret is asked each session.
 */
export function importDraft(candidate: SqlDbImportCandidate, mode: SqlImportPasswordMode, vaultSession: boolean): SqlConnectionDraft {
  const chosen = vaultSession ? 'session' : mode;
  const { draft } = candidate;
  return {
    ...draft,
    passwordMode: draft.passwordMode === 'none' ? 'none' : chosen,
    ...(draft.ssh ? { ssh: { ...draft.ssh, secretMode: draft.ssh.secretMode === 'none' ? 'none' : chosen } } : {}),
  };
}

/** A copy of a saved connection under a new name; its secrets stay with the original. */
export function duplicateDraft(connection: SqlDbConnectionView, suffix: string): SqlConnectionDraft | null {
  const draft = parseConnectionDraft(connection);
  return draft ? { ...draft, name: `${connection.name} ${suffix}`.slice(0, 80) } : null;
}
