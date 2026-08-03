/**
 * HTTP request to cURL serialization.
 *
 * This leaf owns shell quoting and cURL-specific wire fidelity. It prints the
 * request it receives verbatim; callers must mask active environment secrets
 * before passing a request into this module.
 */

import { composeRequestHeaders } from './httpWorkspaceHeaders';
import type { HttpRequestV1 } from './httpWorkspaceSchema';

/**
 * Single-quote a token for a POSIX shell. Embedded single quotes use the
 * `'\''` idiom so the shell never interpolates request content.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a cURL command equivalent to sending `request`.
 *
 * The URL already contains query params and headers already reflect Auth-tab
 * precedence. JSON, form, and text bodies receive the same default
 * Content-Type as the runtime when no explicit Content-Type row exists.
 *
 * This is a copy-my-request surface, so typed values remain intact. An active
 * environment is the exception: callers must first use
 * `maskSecretsForCapsule(request, env)` so secret variables remain as
 * placeholders instead of reaching the clipboard.
 */
export function buildCurlCommand(request: HttpRequestV1): string {
  const parts: string[] = ['curl'];
  if (request.method !== 'GET') {
    parts.push('-X', request.method);
  }
  parts.push(shellQuote(request.url));
  const composed = composeRequestHeaders(request);
  for (const header of composed) {
    parts.push('-H', shellQuote(`${header.name}: ${header.value}`));
  }
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
    const hasContentType = composed.some(
      (header) => header.name.toLowerCase() === 'content-type'
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
        parts.push('-H', shellQuote(`Content-Type: ${defaultContentType}`));
      }
    }
    parts.push('--data', shellQuote(request.body.content ?? ''));
  }
  return parts.join(' ');
}
