/** Entry point of the Local SQL utilityProcess: requests in, responses out on the parent port. */

import { createRequire } from 'node:module';
import type { PointerReader } from './cells';
import { createSqlLocalEngine } from './engine';
import type { LocalRequest } from './protocol';

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

process.parentPort.on('message', (event) => {
  void engine.handle(event.data as LocalRequest).then((response) => process.parentPort.postMessage(response));
});
