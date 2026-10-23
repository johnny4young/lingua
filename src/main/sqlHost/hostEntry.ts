/** Entry point of the SQL host utilityProcess: requests in, responses out on the parent port. */

import { openClickHouse } from './clickhouse';
import { createSqlHost } from './host';
import { openD1Host, openLibsqlHost, openNeonHost } from './httpEngines';
import { openMysql } from './mysql';
import { openPostgres } from './postgres';
import type { HostRequest } from './protocol';
import { openSqlite } from './sqlite';
import { openSqlServer } from './sqlserver';

const host = createSqlHost({
  postgres: openPostgres,
  mysql: openMysql,
  sqlite: openSqlite,
  sqlserver: openSqlServer,
  clickhouse: openClickHouse,
  libsql: openLibsqlHost,
  neon: openNeonHost,
  d1: openD1Host,
});

process.parentPort.on('message', (event) => {
  void host.handle(event.data as HostRequest).then((response) => process.parentPort.postMessage(response));
});

process.on('exit', () => void host.dispose());
