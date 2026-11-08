import type { HttpRequestV1 } from '../../../shared/httpWorkspaceSchema';

export type StarterPatch = Pick<HttpRequestV1, 'method' | 'url' | 'headers' | 'body'>;

export const HTTP_STARTERS: ReadonlyArray<{ id: string; labelKey: string; patch: StarterPatch }> = [
  {
    id: 'get-json',
    labelKey: 'httpWorkspace.starter.getJson',
    patch: { method: 'GET', url: 'https://httpbin.org/json', headers: [], body: { kind: 'none' } },
  },
  {
    id: 'post-json',
    labelKey: 'httpWorkspace.starter.postJson',
    patch: {
      method: 'POST',
      url: 'https://httpbin.org/post',
      headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }],
      body: { kind: 'json', content: '{\n  "name": "Ada"\n}' },
    },
  },
];

/** Starters only fill a request nobody has set up: no URL, headers, body, auth, params, captures, tests or variables. */
export function isPristineRequest(request: HttpRequestV1): boolean {
  return (
    request.url.trim() === '' &&
    request.headers.length === 0 &&
    (request.body === undefined || request.body.kind === 'none' || !request.body.content?.trim()) &&
    (request.auth === undefined || request.auth.kind === 'none') &&
    (request.queryParams ?? []).length === 0 &&
    (request.captures ?? []).length === 0 &&
    (request.assertions ?? []).length === 0 &&
    (request.variables ?? []).length === 0
  );
}
