/**
 * RL-097 Slice 1 fold F — HTTP workspace telemetry helper.
 *
 * Single event: `http.request_executed { method, statusBucket,
 * redactedHeadersBucket }`. NO URL, NO body, NO header values — only
 * closed-enum buckets so dashboards group by intent without leaking
 * request content. Mirrored on update-server with parity test.
 *
 * `redactedHeadersBucket` reuses the `DEPENDENCY_COUNT_BUCKETS` enum
 * shape so we don't fragment the bucket vocabulary across events.
 */

import {
  type HttpMethod,
  type HttpResponseV1,
} from '../../shared/httpWorkspace';
import { statusBucketForResponse } from '../runtime/httpClient';
import { trackEvent } from '../utils/telemetry';

function bucketCount(count: number): '0' | '1' | '2-5' | '6-10' | '>10' {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 10) return '6-10';
  return '>10';
}

export function trackHttpRequestExecuted(
  method: HttpMethod,
  response: HttpResponseV1
): void {
  const statusBucket = statusBucketForResponse(response);
  const redactedHeadersBucket = bucketCount(response.redactedHeaders.length);
  void trackEvent('http.request_executed', {
    method,
    statusBucket,
    redactedHeadersBucket,
  });
}
