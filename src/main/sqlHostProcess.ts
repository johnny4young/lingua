/** The app's one SQL host: a utilityProcess running `.vite/build/sqlHost.js`. */

import path from 'node:path';
import { utilityProcess } from 'electron';
import { createSqlHostSupervisor } from './sqlHostSupervisor';

/** The app's environment without database client settings, so no driver picks up a password or host from it. */
export function hostEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !/^(PG|MYSQL_)/i.test(entry[0]))
  );
}

export const sqlHost = createSqlHostSupervisor(() =>
  utilityProcess.fork(path.join(__dirname, 'sqlHost.js'), [], {
    serviceName: 'Lingua SQL host',
    stdio: 'ignore',
    env: hostEnvironment(process.env),
  })
);

export function disposeSqlHost(): void {
  sqlHost.dispose();
}
