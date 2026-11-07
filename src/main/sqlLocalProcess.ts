/** The native Local SQL engine: a utilityProcess running `.vite/build/sqlLocal.js`, apart from the remote SQL host so neither restart drops the other's sessions. */

import path from 'node:path';
import { utilityProcess } from 'electron';
import type { SqlLocalError } from '../shared/sqlLocal';
import { hostEnvironment } from './sqlHostProcess';
import { createSqlHostSupervisor } from './sqlHostSupervisor';
import type { LocalRequest } from './sqlLocal/protocol';

export const sqlLocalHost = createSqlHostSupervisor<LocalRequest, SqlLocalError>(
  () =>
    utilityProcess.fork(path.join(__dirname, 'sqlLocal.js'), [], {
      serviceName: 'Lingua local SQL',
      stdio: 'ignore',
      env: hostEnvironment(process.env),
    }),
  () => ({ message: 'The SQL engine stopped. Run the query again to start a new one.', code: 'engine-gone' })
);

export function disposeSqlLocalHost(): void {
  sqlLocalHost.dispose();
}
