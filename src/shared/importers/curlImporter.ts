/**
 * implementation — cURL → HTTP request importer adapter.
 *
 * Wraps the shared successor to the implementation "paste in URL
 * field" auto-detect parser (`tryParseCurl` below) and adds three
 * layers on top:
 *
 *   1. The `ImporterAdapter` shape from `./types.ts` so the
 *      registry can iterate uniformly with future importers.
 *   2. A `preview` phase that surfaces lossy cURL flags as
 *      `warnings: ImporterLossyWarning[]` — the UI maps each code
 *      to a localized hint band.
 *   3. Sensitive-header redaction in the preview shape (case-
 *      insensitive exact-match against `BASELINE_SENSITIVE_HEADERS`).
 *      The redacted values DO NOT round-trip — `import(preview)`
 *      writes the originals back into the `HttpRequestV1`, which is
 *      the whole point of importing.
 *
 * The parser intentionally stays at "80% case" coverage (same scope
 * as implementation note):
 *
 *   Supported: `-X` / `--request`, `-H` / `--header`, `-d` /
 *              `--data` / `--data-raw`, `--data-urlencode`,
 *              `--json`, single + double quotes, backslash-newline
 *              continuations.
 *   Surfaced-but-dropped (warnings): `--data-binary @file`,
 *              `-F` / `--form`, `-u` / `--user`, `-b` / `--cookie`,
 *              `-c` / `--cookie-jar`, `-o` / `--output`.
 *   Silent-skip: `--compressed`, `--insecure`, redirect flags
 *              (irrelevant to the request shape).
 *
 * `tryParseCurl` is re-exported from
 * `src/renderer/components/HttpWorkspace/curlImport.ts` so the
 * internal inline editor surface keeps working byte-identically.
 */

import {
  BASELINE_SENSITIVE_HEADERS,
  HTTP_METHODS,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestHeader,
} from '../httpWorkspace';
import type {
  ImporterAdapter,
  ImporterLossyWarning,
  ImporterPreviewOutcome,
} from './types';

/** Parser output: a Lingua-shaped request without persistence metadata. */
export interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: HttpRequestHeader[];
  body?: HttpRequestBody;
}

/** Preview shape includes the parsed request + the lossy-flag warnings. */
export interface CurlImporterPreview {
  /** Parsed shape with sensitive header values redacted to `'<redacted>'`. */
  readonly redacted: ParsedCurl;
  /**
   * Parsed shape with the ORIGINAL header values. NOT shown in the
   * preview UI — `import(preview)` reads from here so the persisted
   * `HttpRequestV1` round-trips the user's actual values.
   */
  readonly original: ParsedCurl;
  /** Closed-enum warning codes for lossy cURL flags we silently dropped. */
  readonly warnings: ReadonlyArray<ImporterLossyWarning>;
}

/** Commit shape — what `import(preview)` returns to the caller. */
export interface CurlImporterResult {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: ReadonlyArray<HttpRequestHeader>;
  readonly body?: HttpRequestBody;
}

const REDACTED_PLACEHOLDER = '<redacted>';

/**
 * Closed-enum mapping of unsupported cURL flags to their lossy-warning
 * codes. The parser walks the argv; any time it sees one of these
 * flags it records the matching code and drops the flag's effect.
 */
const LOSSY_FLAG_CODES: Readonly<Record<string, ImporterLossyWarning>> = {
  '--data-binary': 'curl-data-binary-file',
  '-F': 'curl-multipart-form',
  '--form': 'curl-multipart-form',
  '-u': 'curl-basic-auth',
  '--user': 'curl-basic-auth',
  '-b': 'curl-cookie-jar',
  '--cookie': 'curl-cookie-jar',
  '-c': 'curl-cookie-write',
  '--cookie-jar': 'curl-cookie-write',
  '-o': 'curl-output-file',
  '--output': 'curl-output-file',
};

/**
 * Closed list of unsupported cURL flags that DO consume the next
 * argv token (and would otherwise leave it dangling as a positional,
 * which the parser would then misinterpret as the URL). The parser
 * skips both the flag AND its value when it sees one of these, so
 * the real URL is still correctly identified.
 *
 * The supported flags (`-X`, `-H`, `-d`, `--data`, `--data-raw`,
 * `--data-urlencode`, `--json`) are handled by name in the main
 * loop. This set covers only the LOSSY ones — bare booleans like
 * `--compressed` / `--insecure` / `-k` / `-L` do NOT consume an arg
 * and must NOT appear here.
 */
const UNSUPPORTED_FLAGS_WITH_ARG: ReadonlySet<string> = new Set([
  '-u',
  '--user',
  '-F',
  '--form',
  '-b',
  '--cookie',
  '-c',
  '--cookie-jar',
  '-o',
  '--output',
  '--data-binary',
]);

// ---------------------------------------------------------------------------
// Tokenizer — byte-identical to implementation (single + double quotes,
// backslash-newline continuations).
// ---------------------------------------------------------------------------

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
    tokens.push(token);
  }
  return tokens;
}

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value.toUpperCase());
}

/**
 * Parse a cURL command string. Returns `null` on shape mismatch.
 *
 * This function is shared by the internal inline "paste cURL into URL
 * field" auto-detect and the internal global import overlay via the
 * renderer-side re-export shim. If you change the parser shape, run
 * the existing `tests/components/HttpWorkspace/curlImport.test.ts`
 * suite first and update it deliberately.
 */
export function tryParseCurl(source: string): ParsedCurl | null {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  if (!/^curl\b/i.test(trimmed)) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length < 2) return null;
  if (tokens[0]?.toLowerCase() !== 'curl') return null;
  const args = tokens.slice(1);

  let method: HttpMethod | null = null;
  let url: string | null = null;
  const headers: HttpRequestHeader[] = [];
  let bodyContent: string | null = null;
  let bodyKindOverride: 'json' | 'text' | 'form' | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? '';
    const { flagName, inlineValue } = splitFlagToken(a);
    const readFlagValue = (): string | undefined =>
      inlineValue ?? args[i + 1];
    const consumeSeparateValue = () => {
      if (inlineValue === undefined) i += 1;
    };

    if (flagName === '-X' || flagName === '--request') {
      const next = readFlagValue();
      if (next && isHttpMethod(next)) {
        method = next.toUpperCase() as HttpMethod;
      }
      consumeSeparateValue();
      continue;
    }
    if (flagName === '-H' || flagName === '--header') {
      const next = readFlagValue();
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
      consumeSeparateValue();
      continue;
    }
    if (flagName === '-d' || flagName === '--data' || flagName === '--data-raw') {
      const next = readFlagValue();
      if (next !== undefined) {
        bodyContent = next;
        bodyKindOverride = 'text';
      }
      consumeSeparateValue();
      continue;
    }
    if (flagName === '--data-binary') {
      const next = readFlagValue();
      if (next !== undefined && !next.startsWith('@')) {
        bodyContent = next;
        bodyKindOverride = 'text';
      }
      consumeSeparateValue();
      continue;
    }
    if (flagName === '--data-urlencode') {
      const next = readFlagValue();
      if (next !== undefined) {
        bodyContent = next;
        bodyKindOverride = 'form';
      }
      consumeSeparateValue();
      continue;
    }
    if (flagName === '--json') {
      const next = readFlagValue();
      if (next !== undefined) {
        bodyContent = next;
        bodyKindOverride = 'json';
        if (!method) method = 'POST';
        if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
          headers.push({
            name: 'Content-Type',
            value: 'application/json',
            enabled: true,
          });
        }
      }
      consumeSeparateValue();
      continue;
    }
    // Skip flags we don't model (anything starting with `-`).
    // Supported flags (`-X`, `-H`, `-d`, `--data`, `--data-raw`,
    // `--data-urlencode`, `--json`) are handled by name above.
    // Unsupported lossy flags that consume an argument
    // (`-u`/`--user`, `-F`/`--form`, `-b`/`--cookie`, `-c`/`--cookie-jar`,
    // `-o`/`--output`, `--data-binary`) must skip their argument too —
    // otherwise the next positional token gets misread as the URL.
    // The warning scanner runs in parallel and still emits the
    // appropriate code via `scanLossyWarnings`.
    if (a.startsWith('-')) {
      // Long forms with inline `=value` carry the value with the
      // flag itself; nothing extra to consume.
      if (UNSUPPORTED_FLAGS_WITH_ARG.has(flagName) && inlineValue === undefined) {
        i += 1;
      }
      continue;
    }
    // First non-flag positional token is the URL.
    if (url === null && a.length > 0) {
      url = a;
    }
  }

  if (url === null) return null;
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

// ---------------------------------------------------------------------------
// Lossy-warning scanner — runs in parallel with the parser to surface
// every dropped feature.
// ---------------------------------------------------------------------------

function scanLossyWarnings(source: string): ImporterLossyWarning[] {
  const codes = new Set<ImporterLossyWarning>();
  const tokens = tokenize(source.replace(/\\\r?\n/g, ' ').trim());
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] ?? '';
    const { flagName, inlineValue } = splitFlagToken(t);
    const code = LOSSY_FLAG_CODES[flagName];
    if (code !== undefined) {
      // `--data-binary` only counts as `curl-data-binary-file` when
      // its value starts with `@` (otherwise it's just text data,
      // which we DO support via the regular `--data` semantics).
      if (flagName === '--data-binary') {
        const next = inlineValue ?? tokens[i + 1] ?? '';
        if (!next.startsWith('@')) continue;
      }
      codes.add(code);
    }
  }
  return [...codes];
}

function splitFlagToken(token: string): {
  flagName: string;
  inlineValue?: string;
} {
  if (token.startsWith('--')) {
    const eq = token.indexOf('=');
    if (eq > 0) {
      return { flagName: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
    }
  }
  return { flagName: token };
}

// ---------------------------------------------------------------------------
// Redaction — case-insensitive exact-match against the same baseline
// the HTTP workspace uses for response-side redaction.
// ---------------------------------------------------------------------------

function isSensitiveHeader(name: string): boolean {
  return (BASELINE_SENSITIVE_HEADERS as readonly string[]).includes(
    name.toLowerCase()
  );
}

function redactHeaders(
  headers: ReadonlyArray<HttpRequestHeader>
): HttpRequestHeader[] {
  return headers.map((h) =>
    isSensitiveHeader(h.name) ? { ...h, value: REDACTED_PLACEHOLDER } : { ...h }
  );
}

// ---------------------------------------------------------------------------
// Adapter export.
// ---------------------------------------------------------------------------

function previewCurl(source: string): ImporterPreviewOutcome<CurlImporterPreview> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, reason: 'empty-input' };
  }
  if (!/^curl\b/i.test(source.trim())) {
    return { ok: false, reason: 'unrecognized-format' };
  }
  const parsed = tryParseCurl(source);
  if (parsed === null) {
    return { ok: false, reason: 'malformed' };
  }
  const warnings = scanLossyWarnings(source);
  const original: ParsedCurl = {
    method: parsed.method,
    url: parsed.url,
    headers: parsed.headers.map((h) => ({ ...h })),
    ...(parsed.body ? { body: { ...parsed.body } } : {}),
  };
  const redacted: ParsedCurl = {
    method: parsed.method,
    url: parsed.url,
    headers: redactHeaders(parsed.headers),
    ...(parsed.body ? { body: { ...parsed.body } } : {}),
  };
  return { ok: true, preview: { redacted, original, warnings }, warnings };
}

export const curlImporterAdapter: ImporterAdapter<
  CurlImporterPreview,
  CurlImporterResult
> = {
  id: 'curl-http',
  titleKey: 'importPreview.importer.curlHttp.title',
  descriptionKey: 'importPreview.importer.curlHttp.description',
  detect: (source) => {
    if (typeof source !== 'string') return false;
    return /^curl\b/i.test(source.trim());
  },
  preview: previewCurl,
  import: (preview) => {
    // Round-trip the ORIGINAL (un-redacted) shape — the whole point
    // of importing is to land the user's actual values in the
    // persisted `HttpRequestV1`.
    const { original } = preview;
    return {
      method: original.method,
      url: original.url,
      headers: original.headers.map((h) => ({ ...h })),
      ...(original.body ? { body: { ...original.body } } : {}),
    };
  },
};
