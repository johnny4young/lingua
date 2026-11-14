/** Entry point of the SQL host utilityProcess. */

import { serveHost } from '@electron-stagewright/host-supervisor';
import { openClickHouse } from './clickhouse';
import { createSqlHost } from './host';
import { openD1Host, openLibsqlHost, openNeonHost } from './httpEngines';
import { openMysql } from './mysql';
import { openPostgres } from './postgres';
import { SQL_HOST_OPERATIONS, type SqlHostOps } from './protocol';
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

serveHost<SqlHostOps>({
  operations: SQL_HOST_OPERATIONS,
  start: () => host.handlers,
  stop: () => host.dispose(),
});
