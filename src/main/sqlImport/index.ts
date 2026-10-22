/**
 * Connections from another client's file, read in main and returned without
 * any password: hosts, ports, databases, users, groups, environments, SSL and
 * SSH settings only.
 */

import path from 'node:path';
import { parseConnectionDraft } from '../../shared/sqlConnections';
import type { SqlDbImportCandidate, SqlDbImportResult, SqlDbImportSource } from '../../shared/sqlDb';
import { MAX_IMPORT_CONNECTIONS } from './limits';
import { dataGripCandidates } from './dataGrip';
import { dbeaverCandidates } from './dbeaver';
import { linguaCandidates } from './linguaExport';
import { tablePlusCandidates } from './tablePlus';

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** The file next to the picked one that completes it: TablePlus' groups, DataGrip's per-machine settings. */
export function siblingFile(source: SqlDbImportSource, picked: string): string | null {
  if (source === 'tableplus') return path.join(path.dirname(picked), 'ConnectionGroups.plist');
  if (source === 'datagrip') return path.join(path.dirname(picked), 'dataSources.local.xml');
  return null;
}

export interface ImportContext {
  sibling: Buffer | null;
  home: string;
  /** The picked file's path, for DataGrip's $PROJECT_DIR$. */
  picked: string;
}

type Parsed = Omit<Extract<SqlDbImportResult, { canceled: false }>, 'canceled'> | null;

const PARSERS: Readonly<Record<SqlDbImportSource, (data: Buffer, context: ImportContext) => Parsed>> = {
  tableplus: (data, { sibling, home }) => tablePlusCandidates(data, sibling, home),
  dbeaver: (data) => dbeaverCandidates(data.toString('utf-8')),
  datagrip: (data, { sibling, home, picked }) => {
    // A project's .idea folder sits in the project; the IDE's own options folder has no project.
    const folder = path.dirname(picked);
    const projectDir = path.basename(folder) === '.idea' ? path.dirname(folder) : undefined;
    return dataGripCandidates(data.toString('utf-8'), sibling?.toString('utf-8') ?? null, { home, ...(projectDir ? { projectDir } : {}) });
  },
  lingua: (data) => linguaCandidates(data.toString('utf-8')),
};

/** What `data` (the picked file) holds, or `unrecognized` when it is not that client's file. */
export function importCandidates(source: SqlDbImportSource, data: Buffer | null, context: ImportContext): SqlDbImportResult {
  if (!data) return { canceled: false, found: [], skipped: 0, error: 'unreadable' };
  const parsed = PARSERS[source](data, context);
  if (!parsed) return { canceled: false, found: [], skipped: 0, error: 'unrecognized' };
  return { canceled: false, ...checkedCandidates(parsed.found, parsed.skipped) };
}

/**
 * Only what main itself would accept as a draft crosses to the renderer, at
 * most MAX_IMPORT_CONNECTIONS of them; anything else is counted as left out.
 */
export function checkedCandidates(candidates: ReadonlyArray<SqlDbImportCandidate>, skipped: number): { found: SqlDbImportCandidate[]; skipped: number } {
  const found: SqlDbImportCandidate[] = [];
  for (const candidate of candidates) {
    const draft = found.length < MAX_IMPORT_CONNECTIONS ? parseConnectionDraft(candidate.draft) : null;
    if (draft) found.push({ ...candidate, draft });
    else skipped += 1;
  }
  return { found, skipped };
}
