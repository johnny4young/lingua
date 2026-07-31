/**
 * HTTP URL and query-parameter synchronization.
 *
 * The request URL and Params tab are two views of the same query string. This
 * dependency-light module keeps them coherent without loading auth, capture,
 * assertion, persistence, or serialization behavior.
 */

import type { HttpQueryParam } from './httpWorkspaceSchema';

/**
 * Split a URL string into its base and raw query string. This intentionally
 * accepts partial or invalid URLs because the editor calls it while users type.
 */
function splitUrlQuery(url: string): { base: string; query: string } {
  const hashIdx = url.indexOf('#');
  const withoutHash = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const qIdx = withoutHash.indexOf('?');
  if (qIdx === -1) return { base: withoutHash, query: '' };
  return {
    base: withoutHash.slice(0, qIdx),
    query: withoutHash.slice(qIdx + 1),
  };
}

/** Derive enabled query-param rows from a URL string. */
export function urlToParams(url: string): HttpQueryParam[] {
  const { query } = splitUrlQuery(url);
  if (query.length === 0) return [];
  const params: HttpQueryParam[] = [];
  for (const [key, value] of new URLSearchParams(query)) {
    params.push({ key, value, enabled: true });
  }
  return params;
}

/**
 * Reconcile rows after a direct URL edit. Disabled rows are absent from the
 * encoded URL, so carry them forward after the freshly parsed enabled rows.
 */
export function reconcileParamsWithUrl(
  nextUrl: string,
  prevParams: ReadonlyArray<HttpQueryParam>
): HttpQueryParam[] {
  const fromUrl = urlToParams(nextUrl);
  const disabled = prevParams.filter(param => !param.enabled);
  return [...fromUrl, ...disabled];
}

/** Rebuild a URL from enabled, non-empty query-param rows. */
export function paramsToUrl(url: string, params: ReadonlyArray<HttpQueryParam>): string {
  const hashIdx = url.indexOf('#');
  const fragment = hashIdx === -1 ? '' : url.slice(hashIdx);
  const { base } = splitUrlQuery(url);
  const search = new URLSearchParams();
  for (const param of params) {
    if (!param.enabled) continue;
    if (param.key.length === 0) continue;
    search.append(param.key, param.value);
  }
  const query = search.toString();
  return query.length > 0 ? `${base}?${query}${fragment}` : `${base}${fragment}`;
}
