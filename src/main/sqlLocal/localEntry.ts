/** Entry point of the Local SQL utilityProcess. */

import { createRequire } from 'node:module';
import { serveHost } from '@electron-stagewright/host-supervisor';
import type { PointerReader } from './cells';
import { createSqlLocalEngine } from './engine';
import { SQL_LOCAL_OPERATIONS, SQL_LOCAL_STREAMS, type SqlLocalOps } from './protocol';

/** The binding node-api itself loads, resolved from node-api so its own copy answers. */
function pointerReader(): PointerReader | undefined {
  try {
    const bindings = createRequire(require.resolve('@duckdb/node-api'))('@duckdb/node-bindings') as { get_data_from_pointer?: PointerReader };
    return bindings.get_data_from_pointer;
  } catch {
    return undefined;
  }
}

const engine = createSqlLocalEngine(() => import('@duckdb/node-api'), pointerReader());

serveHost<SqlLocalOps>({
  operations: SQL_LOCAL_OPERATIONS,
  streams: SQL_LOCAL_STREAMS,
  start: () => engine.handlers,
  stop: () => engine.dispose(),
});
