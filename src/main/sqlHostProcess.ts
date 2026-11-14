/** The app's one SQL host: a utilityProcess running `.vite/build/sqlHost.js`. */

import path from 'node:path';
import { utilityProcess } from 'electron';
import { createHost } from '@electron-stagewright/host-supervisor';
import { utilityProcessTransport } from '@electron-stagewright/host-supervisor/utility';
import { SQL_HOST_OPERATIONS, type SqlHostOps } from './sqlHost/protocol';

/** The app's environment without database client settings, so no driver picks up a password or host from it. */
export function hostEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !/^(PG|MYSQL_)/i.test(entry[0]))
  );
}

// A crash or a forced restart ends every session; the next call starts a new host.
export const sqlHost = createHost<SqlHostOps>({
  operations: SQL_HOST_OPERATIONS,
  transport: utilityProcessTransport({
    entry: path.join(__dirname, 'sqlHost.js'),
    serviceName: 'Lingua SQL host',
    stdio: 'ignore',
    env: hostEnvironment(process.env),
    fork: (entry, args, options) => utilityProcess.fork(entry, args, options),
  }),
  onExit: () => 'on-demand',
});

export function disposeSqlHost(): Promise<void> {
  return sqlHost.close();
}
