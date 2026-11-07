/** Entry point of the Local SQL utilityProcess: requests in, responses out on the parent port. */

import { createSqlLocalEngine } from './engine';
import type { LocalRequest } from './protocol';

const engine = createSqlLocalEngine(() => import('@duckdb/node-api'));

process.parentPort.on('message', (event) => {
  void engine.handle(event.data as LocalRequest).then((response) => process.parentPort.postMessage(response));
});

process.on('exit', () => void engine.dispose());
