/** The native Local SQL engine: utilityProcesses running `.vite/build/sqlLocal.js`, apart from the remote SQL host so neither restart drops the other's sessions. */

import path from 'node:path';
import { app, utilityProcess } from 'electron';
import { createHost, minimalEnvironment } from '@electron-stagewright/host-supervisor';
import { utilityProcessTransport } from '@electron-stagewright/host-supervisor/utility';
import { SQL_LOCAL_OPERATIONS, SQL_LOCAL_STREAMS, type SqlLocalOps } from './sqlLocal/protocol';

/** Only what the runtime needs; HOME points at Lingua's own folder so DuckDB's ~/.duckdb defaults never reach the user's. */
export function sqlLocalEnvironment(env: NodeJS.ProcessEnv, home: string): Record<string, string> {
  return minimalEnvironment(env, { home });
}

/** How long a window's process may take to close its engines before main stops it. */
const SQL_LOCAL_STOP_GRACE_MS = 3_000;

/** One window's engine process; it starts on the window's first call, and again after a crash or a forced restart. */
export function createSqlLocalHost() {
  return createHost<SqlLocalOps>({
    operations: SQL_LOCAL_OPERATIONS,
    streams: SQL_LOCAL_STREAMS,
    transport: utilityProcessTransport({
      entry: path.join(__dirname, 'sqlLocal.js'),
      serviceName: 'Lingua local SQL',
      stdio: 'ignore',
      env: sqlLocalEnvironment(process.env, path.join(app.getPath('userData'), 'sql-local', 'home')),
      fork: (entry, args, options) => utilityProcess.fork(entry, args, options),
    }),
    stop: { graceMs: SQL_LOCAL_STOP_GRACE_MS },
    onExit: () => 'on-demand',
  });
}
