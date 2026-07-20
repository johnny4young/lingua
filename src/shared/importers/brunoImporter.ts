/**
 * implementation (implementation note) — Bruno `.bru` → HTTP request importer.
 *
 * Parses a single Bruno request file (the `.bru` text DSL) into one
 * Lingua request, wrapped in the shared `CollectionImporterPreview`
 * shape so the overlay + confirm path handle Postman and Bruno
 * uniformly. A `.bru` file is a sequence of brace-delimited blocks:
 *
 *   meta { name: Get users  type: http }
 *   get  { url: https://api.example.com/users  auth: bearer }
 *   headers { Accept: application/json }
 *   auth:bearer { token: {{token}} }
 *   body:json { { "x": 1 } }
 *   script:pre-request { ... }   // dropped + warned
 *
 * Scope is deliberately the common request shape; `script:*` / `tests`
 * blocks are dropped with a `'bruno-script-dropped'` warning. Anything
 * structurally unparseable rejects cleanly — never a partial import.
 *
 * Pure parser; renderer + shared only. NO IPC, NO network.
 */

import {
  HTTP_METHODS,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestBodyKind,
  type HttpRequestHeader,
} from '../httpWorkspace';
import type {
  BrunoRejectReason,
  ImporterAdapter,
  ImporterLossyWarning,
  ImporterPreviewOutcome,
} from './types';
import type {
  CollectionImporterPreview,
  CollectionImporterResult,
  ParsedCollectionRequest,
} from './postmanImporter';

const BRUNO_METHOD_BLOCKS: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'head',
  'options',
]);

interface BruBlock {
  readonly header: string;
  readonly body: string;
}

type BruQuote = '"' | "'" | '`';

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

/**
 * Probe: does this look like a Bruno `.bru` file? Must contain a
 * method block (`get {` / `post {` / …) or a `meta {` block AND a
 * `url:` directive. Specific enough not to claim arbitrary prose or
 * the JSON the other importers own.
 */
function detectBruno(source: string): boolean {
  if (typeof source !== 'string') return false;
  const head = source.slice(0, 4096);
  const hasBlock =
    /(^|\n)\s*(get|post|put|delete|patch|head|options|meta)\s*\{/i.test(head);
  return hasBlock && /(^|\n)\s*url\s*:/i.test(source);
}

// ---------------------------------------------------------------------------
// Block tokenizer — brace-balanced top-level blocks
// ---------------------------------------------------------------------------

/**
 * Split a `.bru` file into top-level `<header> { <body> }` blocks via
 * brace matching. The `body` is the raw inner text (braces balanced),
 * so a JSON body block keeps its own inner braces intact.
 */
function extractBlocks(source: string): BruBlock[] | null {
  const blocks: BruBlock[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    // Skip whitespace between blocks.
    while (i < n && /\s/.test(source[i] ?? '')) i += 1;
    if (i >= n) break;
    // Read the header up to the opening brace.
    let header = '';
    while (i < n && source[i] !== '{') {
      header += source[i];
      i += 1;
    }
    if (i >= n) break; // header with no `{` — ignore trailing junk.
    // Now at `{`. Capture balanced body.
    i += 1; // consume `{`
    let depth = 1;
    let body = '';
    let quote: BruQuote | null = null;
    let escaped = false;
    while (i < n && depth > 0) {
      const ch = source[i] ?? '';
      if (quote !== null) {
        body += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        body += ch;
        i += 1;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
      body += ch;
      i += 1;
    }
    if (depth !== 0) return null;
    blocks.push({ header: header.trim(), body });
  }
  return blocks;
}

/** Parse `key: value` lines from a block body. Bruno marks a disabled
 * row with a leading `~`. Splits on the FIRST colon so header values
 * containing `:` (e.g. a URL) survive. */
function parseKeyValueLines(
  body: string
): Array<{ key: string; value: string; disabled: boolean }> {
  const out: Array<{ key: string; value: string; disabled: boolean }> = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const disabled = line.startsWith('~');
    const effective = disabled ? line.slice(1).trim() : line;
    const idx = effective.indexOf(':');
    if (idx <= 0) continue;
    const key = effective.slice(0, idx).trim();
    const value = effective.slice(idx + 1).trim();
    if (key.length === 0) continue;
    out.push({ key, value, disabled });
  }
  return out;
}

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value.toUpperCase());
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

function rejectBruno(
  detail: BrunoRejectReason
): ImporterPreviewOutcome<CollectionImporterPreview> {
  if (detail === 'empty-input') return { ok: false, reason: 'empty-input' };
  return { ok: false, reason: 'malformed', detail };
}

function previewBruno(
  source: string
): ImporterPreviewOutcome<CollectionImporterPreview> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return rejectBruno('empty-input');
  }
  const blocks = extractBlocks(source);
  if (blocks === null || blocks.length === 0) return rejectBruno('malformed');

  const warnings = new Set<ImporterLossyWarning>();
  let method: HttpMethod | null = null;
  let url = '';
  const headers: HttpRequestHeader[] = [];
  let body: HttpRequestBody | undefined;
  let title = '';

  for (const block of blocks) {
    const header = block.header.toLowerCase();
    if (BRUNO_METHOD_BLOCKS.has(header)) {
      method = isHttpMethod(header) ? (header.toUpperCase() as HttpMethod) : 'GET';
      for (const { key, value } of parseKeyValueLines(block.body)) {
        if (key.toLowerCase() === 'url') url = value;
      }
      continue;
    }
    if (header === 'meta') {
      for (const { key, value } of parseKeyValueLines(block.body)) {
        if (key.toLowerCase() === 'name') title = value;
      }
      continue;
    }
    if (header === 'headers') {
      for (const { key, value, disabled } of parseKeyValueLines(block.body)) {
        headers.push({ name: key, value, enabled: !disabled });
      }
      continue;
    }
    if (header.startsWith('auth:')) {
      const kind = header.slice('auth:'.length);
      if (kind === 'bearer') {
        for (const { key, value } of parseKeyValueLines(block.body)) {
          if (key.toLowerCase() === 'token') {
            headers.push({
              name: 'Authorization',
              value: `Bearer ${value}`,
              enabled: true,
            });
          }
        }
      } else {
        warnings.add('postman-auth-helper');
      }
      continue;
    }
    if (header.startsWith('body')) {
      body = mapBrunoBody(header, block.body);
      continue;
    }
    if (header.startsWith('script') || header === 'tests' || header === 'assert') {
      if (block.body.trim().length > 0) warnings.add('bruno-script-dropped');
      continue;
    }
    // Unknown block (vars, docs, etc.) — ignore.
  }

  if (method === null) return rejectBruno('invalid-shape');
  if (url.length === 0) return rejectBruno('invalid-shape');

  const requestName = (title.length > 0 ? title : `${method} ${url}`).slice(0, 120);
  const request: ParsedCollectionRequest = {
    name: requestName,
    method,
    url,
    headers,
    ...(body ? { body } : {}),
  };

  const preview: CollectionImporterPreview = {
    kind: 'http-collection',
    source: 'bruno',
    title: title.length > 0 ? title.slice(0, 120) : 'Imported request',
    requests: [request],
    counts: { total: 1, folders: 0, truncated: 0 },
    warnings: [...warnings],
  };
  return { ok: true, preview, warnings: preview.warnings };
}

function mapBrunoBody(header: string, body: string): HttpRequestBody | undefined {
  const trimmed = body.trim();
  if (trimmed.length === 0) return undefined;
  const sub = header.includes(':') ? header.slice(header.indexOf(':') + 1) : '';
  let kind: HttpRequestBodyKind = 'text';
  if (sub === 'json') kind = 'json';
  else if (sub === 'form-urlencoded' || sub === 'multipart-form') kind = 'form';
  else if (sub === 'text' || sub === 'xml' || sub === 'graphql') kind = 'text';
  if (kind === 'form') {
    const content = parseKeyValueLines(body)
      .filter((p) => !p.disabled)
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');
    return content.length > 0 ? { kind, content } : undefined;
  }
  return { kind, content: trimmed };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const brunoImporterAdapter: ImporterAdapter<
  CollectionImporterPreview,
  CollectionImporterResult
> = {
  id: 'bruno-collection',
  titleKey: 'importPreview.importer.brunoCollection.title',
  descriptionKey: 'importPreview.importer.brunoCollection.description',
  detect: detectBruno,
  preview: previewBruno,
  import: (preview) => ({
    source: preview.source,
    title: preview.title,
    requests: preview.requests.map((r) => ({
      ...r,
      headers: r.headers.map((h) => ({ ...h })),
      ...(r.body ? { body: { ...r.body } } : {}),
    })),
  }),
};
