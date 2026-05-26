/**
 * RL-097 Slice 1 fold B — minimal cURL command parser.
 *
 * Goal is NOT to be a full cURL implementation. Goal IS to cover the
 * 80% case: `curl -X METHOD URL -H 'Name: Value' -d 'body'`. Browser
 * copy-as-curl, devtools copy-as-curl, and Postman's export all
 * produce shapes this parser handles.
 *
 * Things explicitly left out (Slice 3+ scope or RL-100 territory):
 *   - Multiline cURL with `\` line continuations (we collapse them
 *     into a single line first, so the simple case works).
 *   - File uploads (`--data-binary @file`, `-F file=@...`).
 *   - Cookie jars (`-b` / `-c`).
 *   - Authorization shortcuts (`-u user:pass` → Basic).
 *   - `--compressed`, `--insecure`, redirect flags (not relevant to
 *     the request shape).
 *
 * Returns `null` when the input is unparseable so the caller can
 * skip the offer notice gracefully.
 */

import {
  HTTP_METHODS,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestHeader,
} from '../../../shared/httpWorkspace';

export interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: HttpRequestHeader[];
  body?: HttpRequestBody;
}

/**
 * Split a cURL string into tokens, respecting single + double
 * quotes (a shell-style tokeniser). Backslash-newline continuations
 * are stripped before tokenisation.
 */
function tokenize(source: string): string[] {
  const collapsed = source.replace(/\\\r?\n/g, ' ').trim();
  const tokens: string[] = [];
  let i = 0;
  while (i < collapsed.length) {
    const ch = collapsed[i] ?? '';
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    let token = '';
    let quote: '"' | "'" | null = null;
    while (i < collapsed.length) {
      const c = collapsed[i];
      if (c === undefined) break;
      if (quote) {
        if (c === quote) {
          quote = null;
          i += 1;
          continue;
        }
        // Inside double quotes, `\X` resolves like POSIX:
        // backslash-double-quote / backslash-backslash / backslash-`
        // are escapes; everything else stays literal.
        if (quote === '"' && c === '\\') {
          const next = collapsed[i + 1];
          if (next === '"' || next === '\\' || next === '`') {
            token += next;
            i += 2;
            continue;
          }
        }
        token += c;
        i += 1;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        i += 1;
        continue;
      }
      if (/\s/.test(c)) break;
      token += c;
      i += 1;
    }
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value.toUpperCase());
}

/**
 * Parse a cURL command string. Returns `null` on shape mismatch.
 */
export function tryParseCurl(source: string): ParsedCurl | null {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  if (!/^curl\b/i.test(trimmed)) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length < 2) return null;
  // Drop the leading `curl` token.
  if (tokens[0]?.toLowerCase() !== 'curl') return null;
  const args = tokens.slice(1);

  let method: HttpMethod | null = null;
  let url: string | null = null;
  const headers: HttpRequestHeader[] = [];
  let bodyContent: string | null = null;
  let bodyKindOverride: 'json' | 'text' | 'form' | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? '';
    if (a === '-X' || a === '--request') {
      const next = args[i + 1];
      if (next && isHttpMethod(next)) {
        method = next.toUpperCase() as HttpMethod;
      }
      i += 1;
      continue;
    }
    if (a === '-H' || a === '--header') {
      const next = args[i + 1];
      if (next) {
        const idx = next.indexOf(':');
        if (idx > 0) {
          const name = next.slice(0, idx).trim();
          const value = next.slice(idx + 1).trim();
          if (name.length > 0) {
            headers.push({ name, value, enabled: true });
          }
        }
      }
      i += 1;
      continue;
    }
    if (a === '-d' || a === '--data' || a === '--data-raw') {
      const next = args[i + 1];
      if (next !== undefined) {
        bodyContent = next;
        // `--data` defaults to `application/x-www-form-urlencoded`.
        // We default to JSON when the body parses as JSON, else text.
        bodyKindOverride = 'text';
      }
      i += 1;
      continue;
    }
    if (a === '--data-urlencode') {
      const next = args[i + 1];
      if (next !== undefined) {
        bodyContent = next;
        bodyKindOverride = 'form';
      }
      i += 1;
      continue;
    }
    if (a === '--json') {
      const next = args[i + 1];
      if (next !== undefined) {
        bodyContent = next;
        bodyKindOverride = 'json';
        // `--json` implies POST.
        if (!method) method = 'POST';
        // `--json` also implies these headers.
        if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
          headers.push({
            name: 'Content-Type',
            value: 'application/json',
            enabled: true,
          });
        }
      }
      i += 1;
      continue;
    }
    // Skip flags we don't model (anything starting with `-`).
    if (a.startsWith('-')) {
      // Some flags consume an argument; the conservative path is to
      // skip ONLY the flag and let the next iteration re-evaluate.
      // Flags we explicitly know consume an arg are handled above.
      continue;
    }
    // First non-flag positional token is the URL.
    if (url === null) {
      url = a;
    }
  }

  if (url === null) return null;
  // Sniff: a body that parses as JSON should be flagged as JSON
  // (avoids treating a `--data '{}'` payload as text/plain).
  if (bodyContent !== null && bodyKindOverride === 'text') {
    try {
      JSON.parse(bodyContent);
      bodyKindOverride = 'json';
      if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
        headers.push({
          name: 'Content-Type',
          value: 'application/json',
          enabled: true,
        });
      }
    } catch {
      // Not JSON; keep as text.
    }
  }

  const finalMethod: HttpMethod =
    method ?? (bodyContent !== null ? 'POST' : 'GET');

  const body: HttpRequestBody | undefined =
    bodyContent !== null
      ? { kind: bodyKindOverride ?? 'text', content: bodyContent }
      : undefined;

  return {
    method: finalMethod,
    url,
    headers,
    ...(body ? { body } : {}),
  };
}
