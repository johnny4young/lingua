/**
 * Chain tags: a `{{variable}}` that another request's capture rule produces.
 * The graph is read from the capture rules, never stored: a request depends on
 * the requests that capture the variables it uses.
 */

import { looksSecret, referencedVariables, type HttpEnvVariableV1 } from './httpEnvironment';
import { extractCaptureValue } from './httpWorkspaceCaptures';
import type { HttpCaptureRule, HttpChainRule, HttpRequestV1, HttpResponseV1 } from './httpWorkspaceSchema';

/** `stale` sends the source again when its latest response is older than this. */
const CHAIN_STALE_MS = 5 * 60_000;
/** A chain longer than this is refused rather than sent. */
const CHAIN_MAX_DEPTH = 20;

export interface HttpChainTag {
  readonly key: string;
  readonly sourceId: string;
  readonly capture: HttpCaptureRule;
  readonly rule: HttpChainRule;
}

/** The request whose enabled capture rule writes each variable, first in list order. */
function producers(requests: ReadonlyArray<HttpRequestV1>): Map<string, { requestId: string; capture: HttpCaptureRule }> {
  const out = new Map<string, { requestId: string; capture: HttpCaptureRule }>();
  for (const request of requests) {
    for (const capture of request.captures ?? []) {
      const key = capture.targetVariable.trim();
      if (!capture.enabled || key.length === 0 || out.has(key)) continue;
      out.set(key, { requestId: request.id, capture });
    }
  }
  return out;
}

/** The variables a request uses that another request captures. */
export function chainTags(request: HttpRequestV1, requests: ReadonlyArray<HttpRequestV1>): HttpChainTag[] {
  const produced = producers(requests);
  const tags: HttpChainTag[] = [];
  for (const key of referencedVariables(request)) {
    const source = produced.get(key);
    if (!source || source.requestId === request.id) continue;
    tags.push({ key, sourceId: source.requestId, capture: source.capture, rule: request.chainRules?.[key] ?? 'last' });
  }
  return tags;
}

/** A response a chain can read from and go on after: an HTTP 2xx. */
export function chainPasses(response: HttpResponseV1 | undefined): response is HttpResponseV1 {
  return response !== undefined && response.kind === 'success' && response.status >= 200 && response.status < 300;
}

/** The tag's value in the source's latest response, or null without a 2xx one. */
export function chainValue(tag: HttpChainTag, latest: HttpResponseV1 | undefined): string | null {
  return chainPasses(latest) ? extractCaptureValue(latest, tag.capture) : null;
}

/** Whether the tag's rule sends its source before the request that uses it. */
export function sourceNeedsSend(tag: HttpChainTag, latest: HttpResponseV1 | undefined, now: number): boolean {
  if (tag.rule === 'source-first') return true;
  if (tag.rule === 'stale') return !chainPasses(latest) || now - Date.parse(latest.recordedAt) > CHAIN_STALE_MS;
  return false;
}

/**
 * Every request the target depends on through its tags, each after the ones it
 * depends on itself, or `cycle` when a request depends on itself.
 */
export function chainOrder(
  targetId: string,
  requests: ReadonlyArray<HttpRequestV1>
): { order: string[]; cycle: boolean } {
  const byId = new Map(requests.map((request) => [request.id, request]));
  const order: string[] = [];
  const done = new Set<string>();
  const path = new Set<string>();
  let cycle = false;
  const visit = (id: string, depth: number): void => {
    if (done.has(id) || cycle) return;
    const request = byId.get(id);
    if (path.has(id) || depth > CHAIN_MAX_DEPTH || !request) {
      cycle ||= path.has(id) || depth > CHAIN_MAX_DEPTH;
      return;
    }
    path.add(id);
    for (const tag of chainTags(request, requests)) visit(tag.sourceId, depth + 1);
    path.delete(id);
    done.add(id);
    if (id !== targetId) order.push(id);
  };
  visit(targetId, 0);
  return { order, cycle };
}

/**
 * Rows for the chain layer: each tag whose source has a 2xx response. A tag
 * stays secret when its key is secret elsewhere or looks like a credential.
 */
export function chainRows(
  tags: readonly HttpChainTag[],
  latest: (requestId: string) => HttpResponseV1 | undefined,
  secretKeys: ReadonlySet<string>
): HttpEnvVariableV1[] {
  const rows: HttpEnvVariableV1[] = [];
  for (const tag of tags) {
    const value = chainValue(tag, latest(tag.sourceId));
    if (value === null) continue;
    rows.push({ id: `chain-${tag.key}`, key: tag.key, value, secret: secretKeys.has(tag.key) || looksSecret(tag.key) });
  }
  return rows;
}
