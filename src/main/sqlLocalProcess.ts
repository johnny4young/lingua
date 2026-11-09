/** The native Local SQL engine: utilityProcesses running `.vite/build/sqlLocal.js`, apart from the remote SQL host so neither restart drops the other's sessions. */

import path from 'node:path';
import { app, utilityProcess } from 'electron';
import type { SqlLocalError } from '../shared/sqlLocal';
import { createSqlHostSupervisor } from './sqlHostSupervisor';
import type { LocalRequest } from './sqlLocal/protocol';

const PASSED_THROUGH = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SystemRoot', 'windir'];

/** Only what the runtime needs; HOME points at Lingua's own folder so DuckDB's ~/.duckdb defaults never reach the user's. */
export function sqlLocalEnvironment(env: NodeJS.ProcessEnv, home: string): Record<string, string> {
  const out: Record<string, string> = { HOME: home, USERPROFILE: home };
  for (const name of PASSED_THROUGH) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** One window's engine process; the service starts one per window, on its first request. */
export function createSqlLocalHost() {
  return createSqlHostSupervisor<LocalRequest, SqlLocalError>(
    () =>
      utilityProcess.fork(path.join(__dirname, 'sqlLocal.js'), [], {
        serviceName: 'Lingua local SQL',
        stdio: 'ignore',
        env: sqlLocalEnvironment(process.env, path.join(app.getPath('userData'), 'sql-local', 'home')),
      }),
    () => ({ message: 'The SQL engine stopped. Run the query again to start a new one.', code: 'engine-gone' })
  );
}
