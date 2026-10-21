/** Entry point of the SQL host utilityProcess: requests in, responses out on the parent port. */

import { createSqlHost } from './host';
import { openMysql } from './mysql';
import { openPostgres } from './postgres';
import type { HostRequest } from './protocol';
import { openSqlite } from './sqlite';

const host = createSqlHost({ postgres: openPostgres, mysql: openMysql, sqlite: openSqlite });

process.parentPort.on('message', (event) => {
  void host.handle(event.data as HostRequest).then((response) => process.parentPort.postMessage(response));
});

process.on('exit', () => void host.dispose());
