/**
 * RL-097 Slice 2 fold F — SQL workspace telemetry helper.
 *
 * Single event: `sql.query_executed { status, rowCountBucket,
 * durationBucket }`. NO query text, NO schema names, NO column
 * names, NO row values — only closed-enum buckets so dashboards
 * group by shape without leaking content. Mirrored on update-server
 * with parity test.
 *
 * `rowCountBucket` reuses the `DEPENDENCY_COUNT_BUCKETS` enum shape
 * so we don't fragment the bucket vocabulary across events.
 * `durationBucket` is a dedicated SQL-side enum because the timing
 * shape ("did this take 10 ms or 30 s?") is the load-bearing signal
 * for the SQL surface.
 */

import {
  bucketSqlDuration,
  type SqlResponseV1,
} from '../../shared/sqlWorkspace';
import { trackEvent } from '../utils/telemetry';

function bucketCount(count: number): '0' | '1' | '2-5' | '6-10' | '>10' {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 10) return '6-10';
  return '>10';
}

export function trackSqlQueryExecuted(response: SqlResponseV1): void {
  void trackEvent('sql.query_executed', {
    status: response.status,
    rowCountBucket: bucketCount(response.rowCount),
    durationBucket: bucketSqlDuration(response.durationMs),
  });
}
