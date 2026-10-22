/** Lingua's own connection export: drafts only, never a password or an id. */

import { parseConnectionDraft, type SqlConnectionV1 } from '../../shared/sqlConnections';
import type { SqlDbImportCandidate } from '../../shared/sqlDb';

const FORMAT = 'lingua.sql-connections';

export function exportText(connections: ReadonlyArray<SqlConnectionV1>, now: Date): string {
  const drafts = connections.map(parseConnectionDraft).filter(Boolean);
  return `${JSON.stringify({ format: FORMAT, version: 1, exportedAt: now.toISOString(), connections: drafts }, null, 2)}\n`;
}

/** The connections in an export; null when the text is not one. */
export function linguaCandidates(text: string): { found: SqlDbImportCandidate[]; skipped: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const record = raw as { format?: unknown; connections?: unknown } | null;
  if (!record || record.format !== FORMAT || !Array.isArray(record.connections)) return null;
  const found: SqlDbImportCandidate[] = [];
  for (const entry of record.connections) {
    const draft = parseConnectionDraft(entry);
    if (draft) found.push({ draft });
  }
  return { found, skipped: record.connections.length - found.length };
}
