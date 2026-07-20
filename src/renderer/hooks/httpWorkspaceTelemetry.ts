/**
 * implementation note — HTTP workspace telemetry
 * helper.
 *
 * Single event: `http.request_executed { method, statusBucket,
 * redactedHeadersBucket, resolvedVarsBucket }`. NO URL, NO body, NO
 * header values, NO env variable names/values — only closed-enum
 * buckets so dashboards group by intent without leaking request
 * content. Mirrored on update-server with parity test.
 *
 * Both `redactedHeadersBucket` and `resolvedVarsBucket` reuse the
 * `DEPENDENCY_COUNT_BUCKETS` enum shape so we don't fragment the bucket
 * vocabulary across events. `resolvedVarsBucket` is the bucketed count
 * of distinct environment `{{vars}}` successfully resolved in the sent
 * request — only the bucket leaves the device, never the values.
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
  response: HttpResponseV1,
  resolvedVarsCount = 0
): void {
  const statusBucket = statusBucketForResponse(response);
  const redactedHeadersBucket = bucketCount(response.redactedHeaders.length);
  const resolvedVarsBucket = bucketCount(resolvedVarsCount);
  void trackEvent('http.request_executed', {
    method,
    statusBucket,
    redactedHeadersBucket,
    resolvedVarsBucket,
  });
}
