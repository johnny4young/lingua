/**
 * HTTP request → code snippet generators (fetch / axios / Python
 * requests), a sibling of `buildCurlCommand` in `httpWorkspace.ts`.
 *
 * Pure + environment-agnostic so the UI can offer "Copy as fetch / axios
 * / Python" next to "Copy as cURL". Fidelity comes from reusing
 * `composeRequestHeaders` (user rows + the injected auth header, auth
 * winning a name collision) and mirroring the runtime's default
 * Content-Type injection, exactly like the cURL builder — so every
 * generated snippet sends the same wire bytes as an actual Send.
 *
 * SECRETS: like the cURL builder, these print the request VERBATIM. A
 * caller with an active environment must pre-process the request through
 * `maskSecretsForCapsule(request, env)` so secret `{{vars}}` stay as
 * placeholders instead of resolving into the clipboard.
 */

import {
  composeRequestHeaders,
  type HttpRequestV1,
} from './httpWorkspace';

/** Closed enum of the languages the generator targets. */
export const HTTP_CODEGEN_TARGETS = [
  'fetch',
  'axios',
  'python-requests',
] as const;

export type HttpCodegenTarget = (typeof HTTP_CODEGEN_TARGETS)[number];

/** Human-facing label for each target (used by the copy menu). */
export const HTTP_CODEGEN_LABELS: Readonly<Record<HttpCodegenTarget, string>> = {
  fetch: 'JavaScript · fetch',
  axios: 'JavaScript · axios',
  'python-requests': 'Python · requests',
};

interface WireShape {
  method: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
  /** The request body string, or null when no body is sent. */
  body: string | null;
}

/**
 * Resolve the exact bytes a Send would put on the wire: composed headers
 * (incl. the default Content-Type the runtime injects for json/form/text
 * bodies when the user did not set one) + the body string, or null when
 * the method / body means nothing is sent. Shared by every generator so
 * they cannot drift from each other or from the cURL builder.
 */
function resolveWireShape(request: HttpRequestV1): WireShape {
  const headers = composeRequestHeaders(request);
  const carriesBody =
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    request.method !== 'OPTIONS';
  const willSendBody =
    carriesBody &&
    !!request.body &&
    request.body.kind !== 'none' &&
    (request.body.content ?? '').length > 0;

  if (willSendBody && request.body) {
    const hasContentType = headers.some(
      (h) => h.name.toLowerCase() === 'content-type'
    );
    if (!hasContentType) {
      const defaultContentType =
        request.body.kind === 'json'
          ? 'application/json'
          : request.body.kind === 'form'
            ? 'application/x-www-form-urlencoded'
            : request.body.kind === 'text'
              ? 'text/plain'
              : null;
      if (defaultContentType !== null) {
        headers.push({ name: 'Content-Type', value: defaultContentType });
      }
    }
    return {
      method: request.method,
      url: request.url,
      headers,
      body: request.body.content ?? '',
    };
  }

  return { method: request.method, url: request.url, headers, body: null };
}

/**
 * Quote a value as a double-quoted string literal valid in BOTH
 * JavaScript and Python 3. `JSON.stringify` emits exactly the escape
 * set both languages accept (`\"`, `\\`, `\n`, `\t`, `\uXXXX`, …).
 */
function quote(value: string): string {
  return JSON.stringify(value);
}

function headersObjectLiteral(
  headers: ReadonlyArray<{ name: string; value: string }>,
  indent: string
): string {
  if (headers.length === 0) return '{}';
  const lines = headers.map(
    (h) => `${indent}  ${quote(h.name)}: ${quote(h.value)}`
  );
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

function buildFetchSnippet(shape: WireShape): string {
  const lines: string[] = [];
  lines.push(`const response = await fetch(${quote(shape.url)}, {`);
  lines.push(`  method: ${quote(shape.method)},`);
  if (shape.headers.length > 0) {
    lines.push(`  headers: ${headersObjectLiteral(shape.headers, '  ')},`);
  }
  if (shape.body !== null) {
    lines.push(`  body: ${quote(shape.body)},`);
  }
  lines.push(`});`);
  lines.push(`const data = await response.text();`);
  return lines.join('\n');
}

function buildAxiosSnippet(shape: WireShape): string {
  const lines: string[] = [];
  lines.push(`import axios from "axios";`);
  lines.push(``);
  lines.push(`const response = await axios({`);
  lines.push(`  method: ${quote(shape.method.toLowerCase())},`);
  lines.push(`  url: ${quote(shape.url)},`);
  if (shape.headers.length > 0) {
    lines.push(`  headers: ${headersObjectLiteral(shape.headers, '  ')},`);
  }
  if (shape.body !== null) {
    lines.push(`  data: ${quote(shape.body)},`);
  }
  lines.push(`});`);
  return lines.join('\n');
}

function buildPythonRequestsSnippet(shape: WireShape): string {
  const lines: string[] = [];
  lines.push(`import requests`);
  lines.push(``);
  lines.push(`response = requests.request(`);
  lines.push(`    ${quote(shape.method)},`);
  lines.push(`    ${quote(shape.url)},`);
  if (shape.headers.length > 0) {
    const headerLines = shape.headers.map(
      (h) => `        ${quote(h.name)}: ${quote(h.value)}`
    );
    lines.push(`    headers={\n${headerLines.join(',\n')}\n    },`);
  }
  if (shape.body !== null) {
    lines.push(`    data=${quote(shape.body)},`);
  }
  lines.push(`)`);
  return lines.join('\n');
}

/**
 * Generate a code snippet equivalent to sending `request` in the given
 * target language / library. The request should already be masked for
 * the active environment (see the module header) when a secret is bound.
 */
export function generateHttpCode(
  request: HttpRequestV1,
  target: HttpCodegenTarget
): string {
  const shape = resolveWireShape(request);
  switch (target) {
    case 'fetch':
      return buildFetchSnippet(shape);
    case 'axios':
      return buildAxiosSnippet(shape);
    case 'python-requests':
      return buildPythonRequestsSnippet(shape);
  }
}
