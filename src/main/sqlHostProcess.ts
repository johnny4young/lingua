/** The app's one SQL host: a utilityProcess running `.vite/build/sqlHost.js`. */

import path from 'node:path';
import { utilityProcess } from 'electron';
import { createSqlHostSupervisor } from './sqlHostSupervisor';

export const sqlHost = createSqlHostSupervisor(() =>
  utilityProcess.fork(path.join(__dirname, 'sqlHost.js'), [], { serviceName: 'Lingua SQL host', stdio: 'ignore' })
);

export function disposeSqlHost(): void {
  sqlHost.dispose();
}
