/**
 * Connections from another client's file, read in main and returned without
 * any password: hosts, ports, databases, users, SSL and SSH settings only.
 */

import path from 'node:path';
import type { SqlDbImportResult, SqlDbImportSource } from '../../shared/sqlDb';
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
  return parsed ? { canceled: false, ...parsed } : { canceled: false, found: [], skipped: 0, error: 'unrecognized' };
}
