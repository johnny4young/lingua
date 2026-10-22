/**
 * The client files an import may read inside an app-data folder Lingua
 * otherwise never opens: TablePlus and the JetBrains IDEs keep theirs under
 * ~/Library/Application Support, DBeaver under %APPDATA% on Windows.
 */

import path from 'node:path';
import type { SqlDbImportSource } from '../../shared/sqlDb';

type Segment = string | RegExp;

const IDE = /^[\w.-]{1,64}$/;

const CLIENT_FILES: Readonly<Partial<Record<SqlDbImportSource, Segment[][]>>> = {
  tableplus: [['Library', 'Application Support', /^com\.tinyapp\.TablePlus(-setapp)?$/, 'Data', /^(Connections|ConnectionGroups)\.plist$/]],
  datagrip: [
    ['Library', 'Application Support', 'JetBrains', IDE, 'options', /^dataSources(\.local)?\.xml$/],
    ['AppData', 'Roaming', 'JetBrains', IDE, 'options', /^dataSources(\.local)?\.xml$/],
  ],
  dbeaver: [['AppData', 'Roaming', 'DBeaverData', 'workspace6', IDE, '.dbeaver', /^data-sources[\w-]*\.json$/]],
};

/** Whether `file`, which sits in an app-data folder, is exactly one of this client's connection files. */
export function isClientFile(source: SqlDbImportSource, file: string, home: string): boolean {
  // Every pattern starts with a literal folder, so a path outside home (../…) never matches.
  const parts = path.relative(home, file).split(path.sep);
  return (CLIENT_FILES[source] ?? []).some(
    (pattern) => pattern.length === parts.length && pattern.every((segment, index) => (typeof segment === 'string' ? segment === parts[index] : segment.test(parts[index]!)))
  );
}
