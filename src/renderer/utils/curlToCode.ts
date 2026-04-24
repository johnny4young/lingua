/**
 * RL-070 — cURL → Code converter helper.
 *
 * Pure, offline, renderer-side. Takes a cURL invocation and produces
 * equivalent code in one of four targets:
 *
 * - `fetch`   — browser Fetch API.
 * - `undici`  — Node `undici.request` client.
 * - `requests` — Python `requests` library.
 * - `net-http` — Go `net/http` with a default client.
 *
 * The argv tokenizer understands POSIX-ish quoting (single quotes,
 * double quotes with backslash escapes, unquoted words) plus line
 * continuations (`\` immediately before a newline). Flag support
 * mirrors the options a typical developer-facing cURL copy-paste
 * will carry: `-X` / `--request`, `-H` / `--header`, `-d` / `--data`
 * / `--data-raw`, `--data-binary` (file forms like `@file` refused),
 * `-u` / `--user`, `--cookie`, `-A` / `--user-agent`, `-L` /
 * `--location`, and `-G` (GET + body → query string).
 *
 * Unknown flags are collected into `warnings` and surfaced at the
 * top of the generated code as a comment, rather than aborting
 * the conversion — the partial output is usually still useful.
 *
 * The 50 KB input cap catches pathological blobs and keeps the
 * tokenizer O(n).
 */

export type CurlTarget = 'fetch' | 'undici' | 'requests' | 'net-http';

export const CURL_TARGETS: readonly CurlTarget[] = ['fetch', 'undici', 'requests', 'net-http'];

export const CURL_TO_CODE_MAX_BYTES = 50 * 1024; // 50 KB
export const CURL_TO_CODE_MAX_KB = Math.round(CURL_TO_CODE_MAX_BYTES / 1024);

export interface CurlBasicAuth {
  readonly user: string;
  readonly password: string;
}

export interface CurlCommand {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly basicAuth: CurlBasicAuth | null;
  readonly followRedirects: boolean;
  readonly userAgent: string | null;
  readonly cookie: string | null;
  readonly warnings: readonly string[];
}

export interface ConvertCurlOptions {
  readonly target: CurlTarget;
}

export type ParseCurlResult =
  | { ok: true; command: CurlCommand }
  | { ok: false; errorKey: string; message?: string };

export type ConvertCurlResult =
  | { ok: true; code: string; command: CurlCommand }
  | { ok: false; errorKey: string; message?: string };

/**
 * Tokenize a cURL invocation into a `CurlCommand`. Accepts either a
 * full `curl …` command or a bare argv list (the leading `curl` is
 * optional; we strip it if present).
 */
export function parseCurlCommand(input: string): ParseCurlResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.curlToCode.error.empty' };
  }

  const byteLength = new TextEncoder().encode(trimmed).byteLength;
  if (byteLength > CURL_TO_CODE_MAX_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.curlToCode.error.tooLarge' };
  }

  let tokens: string[];
  try {
    tokens = tokenize(trimmed);
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.curlToCode.error.parseFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (tokens.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.curlToCode.error.empty' };
  }

  // Strip a leading `curl` token if the user pasted the whole command.
  if (tokens[0] === 'curl') {
    tokens.shift();
  }

  const headers: Record<string, string> = {};
  const dataPieces: string[] = [];
  const warnings: string[] = [];
  let explicitMethod: string | null = null;
  let url: string | null = null;
  let basicAuth: CurlBasicAuth | null = null;
  let followRedirects = false;
  let userAgent: string | null = null;
  let cookie: string | null = null;
  let convertBodyToQuery = false;
  let fileBodyRejected = false;

  const addHeader = (value: string) => {
    const colon = value.indexOf(':');
    if (colon <= 0) {
      warnings.push(`Header without colon: ${value}`);
      return;
    }
    const name = value.slice(0, colon).trim();
    const headerValue = value.slice(colon + 1).trim();
    if (name.length > 0) headers[name] = headerValue;
  };

  const addBasicAuth = (value: string) => {
    const sep = value.indexOf(':');
    if (sep >= 0) {
      basicAuth = { user: value.slice(0, sep), password: value.slice(sep + 1) };
    } else {
      basicAuth = { user: value, password: '' };
    }
  };

  const setExplicitUrl = (value: string) => {
    if (value.length === 0) return;
    if (url === null) {
      url = value;
    } else {
      warnings.push(`Additional URL ignored: ${value}`);
    }
  };

  const applyOptionValue = (flag: string, value: string): boolean => {
    if (flag === '-X' || flag === '--request') {
      explicitMethod = value.toUpperCase();
      return true;
    }
    if (flag === '-H' || flag === '--header') {
      addHeader(value);
      return true;
    }
    if (flag === '-d' || flag === '--data') {
      if (value.startsWith('@')) {
        fileBodyRejected = true;
      } else {
        dataPieces.push(value);
      }
      return true;
    }
    if (flag === '--data-raw') {
      dataPieces.push(value);
      return true;
    }
    if (flag === '--data-binary') {
      if (value.startsWith('@')) {
        fileBodyRejected = true;
      } else {
        dataPieces.push(value);
      }
      return true;
    }
    if (flag === '--data-urlencode') {
      if (value.startsWith('@')) {
        fileBodyRejected = true;
      } else {
        dataPieces.push(urlEncodeDataPiece(value));
      }
      return true;
    }
    if (flag === '-u' || flag === '--user') {
      addBasicAuth(value);
      return true;
    }
    if (flag === '-A' || flag === '--user-agent') {
      userAgent = value;
      return true;
    }
    if (flag === '--cookie' || flag === '-b') {
      cookie = value;
      return true;
    }
    if (flag === '--url') {
      setExplicitUrl(value);
      return true;
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) continue;

    const equalsIndex = token.startsWith('--') ? token.indexOf('=') : -1;
    if (equalsIndex > 2) {
      const flag = token.slice(0, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      if (applyOptionValue(flag, value)) continue;
    }

    const inlineShortFlag =
      token.length > 2 && token.startsWith('-') && !token.startsWith('--')
        ? token.slice(0, 2)
        : null;
    if (inlineShortFlag !== null) {
      const value = token.slice(2);
      if (applyOptionValue(inlineShortFlag, value)) continue;
    }

    if (token === '-X' || token === '--request') {
      const next = tokens[++i];
      if (next !== undefined) applyOptionValue(token, next);
      continue;
    }
    if (token === '-H' || token === '--header') {
      const next = tokens[++i];
      if (next === undefined) continue;
      applyOptionValue(token, next);
      continue;
    }
    if (token === '-d' || token === '--data' || token === '--data-raw') {
      const next = tokens[++i];
      if (next !== undefined) applyOptionValue(token, next);
      continue;
    }
    if (token === '--data-binary') {
      const next = tokens[++i];
      if (next === undefined) continue;
      applyOptionValue(token, next);
      continue;
    }
    if (token === '--data-urlencode') {
      const next = tokens[++i];
      if (next === undefined) continue;
      applyOptionValue(token, next);
      continue;
    }
    if (token === '-u' || token === '--user') {
      const next = tokens[++i];
      if (next === undefined) continue;
      applyOptionValue(token, next);
      continue;
    }
    if (token === '-A' || token === '--user-agent') {
      const next = tokens[++i];
      if (next !== undefined) applyOptionValue(token, next);
      continue;
    }
    if (token === '--cookie' || token === '-b') {
      const next = tokens[++i];
      if (next !== undefined) applyOptionValue(token, next);
      continue;
    }
    if (token === '--url') {
      const next = tokens[++i];
      if (next !== undefined) applyOptionValue(token, next);
      continue;
    }
    if (token === '-L' || token === '--location') {
      followRedirects = true;
      continue;
    }
    if (token === '-G' || token === '--get') {
      convertBodyToQuery = true;
      continue;
    }
    if (token === '-k' || token === '--insecure' || token === '-s' || token === '--silent' || token === '--compressed') {
      // Known-but-unsupported flags (transport-level). Swallow silently.
      continue;
    }
    if (token.startsWith('-')) {
      // Long flags that take an argument (`--foo value`) vs standalone boolean
      // (`--foo`) can't be disambiguated without a full cURL manifest. Peek
      // at the next token; if it doesn't start with a flag prefix and isn't
      // the URL (no scheme + no dot), treat it as a value and skip it.
      warnings.push(`Unknown flag ignored: ${token}`);
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('-') && !looksLikeUrl(next)) {
        i += 1;
      }
      continue;
    }

    // Positional argument → URL (first wins).
    if (url === null) {
      url = token;
    }
  }

  if (fileBodyRejected) {
    return {
      ok: false,
      errorKey: 'utilities.tool.curlToCode.error.fileBodyUnsupported',
    };
  }

  if (url === null) {
    return { ok: false, errorKey: 'utilities.tool.curlToCode.error.missingUrl' };
  }

  // Flag the contradictory combination of `-u` and an explicit
  // Authorization header so the user sees that one will clobber the
  // other at the codegen stage.
  if (basicAuth !== null && hasHeader(headers, 'Authorization')) {
    warnings.push('Both -u and an explicit Authorization header were set; basic auth will overwrite the header.');
  }

  const body = dataPieces.length > 0 ? dataPieces.join('&') : null;

  // Resolve method: explicit -X wins; otherwise default to GET unless a
  // body is present, in which case cURL defaults to POST.
  let method = explicitMethod ?? (body !== null ? 'POST' : 'GET');

  // `-G` forces GET and moves the body into the query string.
  let effectiveUrl = url;
  let effectiveBody = body;
  if (convertBodyToQuery && body !== null) {
    const separator = url.includes('?') ? '&' : '?';
    effectiveUrl = `${url}${separator}${body}`;
    effectiveBody = null;
    method = 'GET';
  }

  const command: CurlCommand = {
    url: effectiveUrl,
    method,
    headers: Object.freeze({ ...headers }),
    body: effectiveBody,
    basicAuth,
    followRedirects,
    userAgent,
    cookie,
    warnings: Object.freeze([...warnings]),
  };
  return { ok: true, command };
}

export function convertCurlToCode(
  input: string,
  options: ConvertCurlOptions
): ConvertCurlResult {
  const parsed = parseCurlCommand(input);
  if (!parsed.ok) return parsed;
  try {
    const code = generateCode(parsed.command, options.target);
    return { ok: true, code, command: parsed.command };
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.curlToCode.error.codegenFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function generateCode(command: CurlCommand, target: CurlTarget): string {
  switch (target) {
    case 'fetch':
      return generateFetch(command);
    case 'undici':
      return generateUndici(command);
    case 'requests':
      return generateRequests(command);
    case 'net-http':
      return generateNetHttp(command);
  }
}

// ---------- Codegen: fetch ----------

function generateFetch(command: CurlCommand): string {
  const lines: string[] = [];
  for (const warning of command.warnings) {
    lines.push(`// ${sanitizeCommentText(warning)}`);
  }
  const headers = mergedHeaders(command, { addBasicAuth: true });
  const parts: string[] = [`method: ${jsString(command.method)}`];
  if (Object.keys(headers).length > 0) {
    parts.push(`headers: ${jsObject(headers, 2)}`);
  }
  if (command.body !== null) {
    parts.push(`body: ${jsString(command.body)}`);
  }
  // Deliberately leave `redirect` unset: fetch defaults to `'follow'`,
  // which matches what most devs want when porting a cURL command to
  // the browser. cURL without `-L` does not follow redirects, but
  // fetch has no faithful equivalent (`'manual'` produces an opaque
  // response; `'error'` throws). Forcing a non-default here surprises
  // users more than it helps.
  lines.push(`const response = await fetch(${jsString(command.url)}, {`);
  for (let i = 0; i < parts.length; i += 1) {
    lines.push(`  ${parts[i]}${i < parts.length - 1 ? ',' : ''}`);
  }
  lines.push(`});`);
  lines.push(`const data = await response.text();`);
  return lines.join('\n');
}

// ---------- Codegen: undici ----------

function generateUndici(command: CurlCommand): string {
  const lines: string[] = [`import { request } from 'undici';`, ''];
  for (const warning of command.warnings) {
    lines.push(`// ${sanitizeCommentText(warning)}`);
  }
  const headers = mergedHeaders(command, { addBasicAuth: true });
  const parts: string[] = [`method: ${jsString(command.method)}`];
  if (Object.keys(headers).length > 0) {
    parts.push(`headers: ${jsObject(headers, 2)}`);
  }
  if (command.body !== null) {
    parts.push(`body: ${jsString(command.body)}`);
  }
  lines.push(`const { statusCode, body } = await request(${jsString(command.url)}, {`);
  for (let i = 0; i < parts.length; i += 1) {
    lines.push(`  ${parts[i]}${i < parts.length - 1 ? ',' : ''}`);
  }
  lines.push(`});`);
  lines.push(`const data = await body.text();`);
  return lines.join('\n');
}

// ---------- Codegen: requests ----------

function generateRequests(command: CurlCommand): string {
  const lines: string[] = ['import requests', ''];
  for (const warning of command.warnings) {
    lines.push(`# ${sanitizeCommentText(warning)}`);
  }
  const kwargs: string[] = [];
  const headers = mergedHeaders(command, { addBasicAuth: false });
  if (Object.keys(headers).length > 0) {
    kwargs.push(`headers=${pyDict(headers)}`);
  }
  if (command.body !== null) {
    kwargs.push(`data=${pyString(command.body)}`);
  }
  if (command.basicAuth) {
    kwargs.push(`auth=(${pyString(command.basicAuth.user)}, ${pyString(command.basicAuth.password)})`);
  }
  if (command.followRedirects === false) {
    kwargs.push('allow_redirects=False');
  }
  const call = `requests.request(${pyString(command.method)}, ${pyString(command.url)}${kwargs.length > 0 ? ', ' + kwargs.join(', ') : ''})`;
  lines.push(`response = ${call}`);
  lines.push(`data = response.text`);
  return lines.join('\n');
}

// ---------- Codegen: net/http ----------

function generateNetHttp(command: CurlCommand): string {
  const imports = ['\t"io"', '\t"net/http"'];
  if (command.body !== null) {
    imports.push('\t"strings"');
  }
  const lines: string[] = [
    'package main',
    '',
    'import (',
    ...imports,
    ')',
    '',
    'func main() {',
  ];
  for (const warning of command.warnings) {
    lines.push(`\t// ${sanitizeCommentText(warning)}`);
  }
  const bodyVar = command.body !== null ? 'body' : 'nil';
  if (command.body !== null) {
    lines.push(`\tbody := strings.NewReader(${goString(command.body)})`);
  }
  lines.push(`\treq, err := http.NewRequest(${goString(command.method)}, ${goString(command.url)}, ${bodyVar})`);
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');
  const headers = mergedHeaders(command, { addBasicAuth: false });
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`\treq.Header.Set(${goString(name)}, ${goString(value)})`);
  }
  if (command.basicAuth) {
    lines.push(`\treq.SetBasicAuth(${goString(command.basicAuth.user)}, ${goString(command.basicAuth.password)})`);
  }
  lines.push('\tclient := &http.Client{}');
  if (command.followRedirects === false) {
    lines.push('\tclient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }');
  }
  lines.push('\tresp, err := client.Do(req)');
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');
  lines.push('\tdefer resp.Body.Close()');
  lines.push('\t_, _ = io.ReadAll(resp.Body)');
  lines.push('}');
  return lines.join('\n');
}

// ---------- Shared helpers ----------

function mergedHeaders(
  command: CurlCommand,
  options: { addBasicAuth: boolean }
): Record<string, string> {
  const merged: Record<string, string> = { ...command.headers };
  if (command.userAgent !== null && merged['User-Agent'] === undefined) {
    merged['User-Agent'] = command.userAgent;
  }
  if (command.cookie !== null && merged['Cookie'] === undefined) {
    merged['Cookie'] = command.cookie;
  }
  if (options.addBasicAuth && command.basicAuth) {
    const token = toBase64(`${command.basicAuth.user}:${command.basicAuth.password}`);
    merged['Authorization'] = `Basic ${token}`;
  }
  return merged;
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function jsObject(obj: Record<string, string>, indent: number): string {
  const pad = '  '.repeat(indent);
  const outerPad = '  '.repeat(indent - 1);
  const entries = Object.entries(obj).map(([k, v]) => `${pad}${jsString(k)}: ${jsString(v)}`);
  if (entries.length === 0) return '{}';
  return `{\n${entries.join(',\n')},\n${outerPad}}`;
}

function pyString(value: string): string {
  // Python accepts JSON-style string literals for simple ASCII; for control
  // chars we'd need repr(), but cURL copy-paste content is almost always
  // printable. JSON.stringify gives us `\n`, `\"`, and `\\` for free.
  return JSON.stringify(value);
}

function pyDict(obj: Record<string, string>): string {
  const entries = Object.entries(obj).map(([k, v]) => `${pyString(k)}: ${pyString(v)}`);
  if (entries.length === 0) return '{}';
  return `{${entries.join(', ')}}`;
}

function goString(value: string): string {
  // Go string literals: wrap in double quotes, escape \, ", and newlines.
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function sanitizeCommentText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /');
}

function looksLikeUrl(token: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(token) || token.includes('.');
}

/**
 * Percent-encode a `--data-urlencode` argument per cURL's own rules:
 * - `name=value` → `name=<encoded value>`
 * - `=value`     → `=<encoded value>` (no name prefix, leading `=` kept)
 * - `value`      → `<encoded value>`
 */
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lowerTarget = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerTarget);
}

function urlEncodeDataPiece(piece: string): string {
  if (piece.startsWith('=')) {
    return `=${encodeURIComponent(piece.slice(1))}`;
  }
  const eq = piece.indexOf('=');
  if (eq > 0) {
    return `${piece.slice(0, eq)}=${encodeURIComponent(piece.slice(eq + 1))}`;
  }
  return encodeURIComponent(piece);
}

// ---------- Tokenizer ----------

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let currentHasToken = false;
  let quote: '"' | "'" | null = null;
  let i = 0;
  const len = input.length;

  const flush = () => {
    if (currentHasToken) {
      tokens.push(current);
      current = '';
      currentHasToken = false;
    }
  };

  while (i < len) {
    const char = input[i] ?? '';
    if (quote === null) {
      // Line continuation: `\` immediately before newline → skip the
      // backslash + the full CR / LF / CRLF / LFCR sequence, do not
      // flush. Walk past every consecutive newline byte so the tokenizer
      // never leaks a stray `\r` into the next token on Windows-style
      // inputs.
      if (char === '\\' && (input[i + 1] === '\n' || input[i + 1] === '\r')) {
        i += 1;
        while (i < len && (input[i] === '\n' || input[i] === '\r')) {
          i += 1;
        }
        continue;
      }
      // Backslash escape outside quotes — keep the escaped char literally.
      if (char === '\\' && i + 1 < len) {
        current += input[i + 1];
        currentHasToken = true;
        i += 2;
        continue;
      }
      if (char === '"' || char === "'") {
        currentHasToken = true;
        quote = char;
        i += 1;
        continue;
      }
      if (/\s/.test(char)) {
        flush();
        i += 1;
        continue;
      }
      current += char;
      currentHasToken = true;
      i += 1;
      continue;
    }

    // Inside quotes.
    if (quote === '"') {
      if (char === '\\' && i + 1 < len) {
        const next = input[i + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n') {
          if (next !== '\n') current += next;
          currentHasToken = true;
          i += 2;
          continue;
        }
        // Unknown escape inside double quotes: keep both chars.
        current += char + (next ?? '');
        currentHasToken = true;
        i += 2;
        continue;
      }
      if (char === '"') {
        quote = null;
        i += 1;
        continue;
      }
      current += char;
      currentHasToken = true;
      i += 1;
      continue;
    }

    // Inside single quotes: no escapes. Only `'` closes.
    if (char === "'") {
      quote = null;
      i += 1;
      continue;
    }
    current += char;
    currentHasToken = true;
    i += 1;
  }

  if (quote !== null) {
    throw new Error(`Unclosed ${quote === '"' ? 'double' : 'single'} quote`);
  }

  flush();
  return tokens;
}
