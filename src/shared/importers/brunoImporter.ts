/**
 * Bruno classic `.bru` / OpenCollection YAML → HTTP request importer.
 *
 * Parses a single Bruno request file into one
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
 * Directory aggregation accepts mixed classic/YAML collections and prefixes
 * folder paths into the flat request list. Pure parser; NO IPC, NO network.
 */

import { load as parseYaml } from 'js-yaml';
import {
  HTTP_METHODS,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestBodyKind,
  type HttpRequestHeader,
} from '../httpWorkspaceSchema';
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
import { MAX_IMPORT_REQUESTS } from './postmanImporter';

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
  const hasBlock = /(^|\n)\s*(get|post|put|delete|patch|head|options|meta)\s*\{/i.test(head);
  if (hasBlock && /(^|\n)\s*url\s*:/i.test(source)) return true;
  return (
    /(^|\n)\s*info\s*:\s*(?:\n|$)/i.test(head) &&
    /(^|\n)\s*http\s*:\s*(?:\n|$)/i.test(head) &&
    /(^|\n)\s+method\s*:/i.test(source) &&
    /(^|\n)\s+url\s*:/i.test(source)
  );
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

function rejectBruno(detail: BrunoRejectReason): ImporterPreviewOutcome<CollectionImporterPreview> {
  if (detail === 'empty-input') return { ok: false, reason: 'empty-input' };
  const reason =
    detail === 'directory-too-many-files' ||
    detail === 'directory-oversized' ||
    detail === 'directory-unreadable'
      ? 'unsupported-feature'
      : 'malformed';
  return { ok: false, reason, detail };
}

function previewBruno(source: string): ImporterPreviewOutcome<CollectionImporterPreview> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return rejectBruno('empty-input');
  }
  if (/^\s*info\s*:/i.test(source) && /(^|\n)\s*http\s*:/i.test(source)) {
    return previewOpenCollectionRequest(source);
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

// ---------------------------------------------------------------------------
// OpenCollection YAML request parser
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (isRecord(value)) return Object.values(value).some(hasMeaningfulValue);
  return true;
}

function mapOpenCollectionHeaders(value: unknown): HttpRequestHeader[] {
  if (Array.isArray(value)) {
    return value.flatMap(entry => {
      if (!isRecord(entry)) return [];
      const name = stringValue(entry.name ?? entry.key).trim();
      if (!name) return [];
      return [
        {
          name,
          value: stringValue(entry.value),
          enabled: entry.enabled !== false && entry.disabled !== true,
        },
      ];
    });
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([name, rawValue]) => ({
    name,
    value: stringValue(rawValue),
    enabled: true,
  }));
}

function mapOpenCollectionBody(value: unknown): HttpRequestBody | undefined {
  if (!isRecord(value)) return undefined;
  const type = stringValue(value.type ?? value.mode).toLowerCase();
  if (type === 'multipart-form') return undefined;
  const raw = value.data ?? value.content ?? value.text ?? value.json;
  if (raw === undefined || raw === null) return undefined;
  const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  if (!content.trim()) return undefined;
  if (type === 'json' || value.json !== undefined) return { kind: 'json', content };
  if (type === 'form-urlencoded' || type === 'form') {
    if (Array.isArray(raw)) {
      const encoded = raw
        .flatMap(entry => {
          if (!isRecord(entry) || entry.enabled === false) return [];
          const name = stringValue(entry.name ?? entry.key);
          return name
            ? [`${encodeURIComponent(name)}=${encodeURIComponent(stringValue(entry.value))}`]
            : [];
        })
        .join('&');
      return encoded ? { kind: 'form', content: encoded } : undefined;
    }
    return { kind: 'form', content };
  }
  return { kind: 'text', content };
}

function previewOpenCollectionRequest(
  source: string
): ImporterPreviewOutcome<CollectionImporterPreview> {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch {
    return rejectBruno('malformed');
  }
  if (!isRecord(parsed) || !isRecord(parsed.info) || !isRecord(parsed.http)) {
    return rejectBruno('invalid-shape');
  }
  const rawMethod = stringValue(parsed.http.method).toUpperCase();
  const url = stringValue(parsed.http.url).trim();
  if (!isHttpMethod(rawMethod) || !url) return rejectBruno('invalid-shape');

  const title = stringValue(parsed.info.name).trim();
  const headers = mapOpenCollectionHeaders(parsed.http.headers);
  const auth = isRecord(parsed.http.auth) ? parsed.http.auth : undefined;
  if (auth && stringValue(auth.type).toLowerCase() === 'bearer') {
    const token = stringValue(auth.token ?? auth.value);
    if (token) headers.push({ name: 'Authorization', value: `Bearer ${token}`, enabled: true });
  }
  const warnings = new Set<ImporterLossyWarning>();
  if (
    auth &&
    stringValue(auth.type) &&
    stringValue(auth.type).toLowerCase() !== 'none' &&
    stringValue(auth.type).toLowerCase() !== 'bearer'
  ) {
    warnings.add('postman-auth-helper');
  }
  if (
    isRecord(parsed.runtime) &&
    (hasMeaningfulValue(parsed.runtime.scripts) || hasMeaningfulValue(parsed.runtime.assertions))
  ) {
    warnings.add('bruno-script-dropped');
  }

  const bodyConfig = isRecord(parsed.http.body) ? parsed.http.body : undefined;
  const bodyType = bodyConfig
    ? stringValue(bodyConfig.type ?? bodyConfig.mode).toLowerCase()
    : '';
  if (bodyType === 'graphql') warnings.add('postman-graphql-body');
  if (bodyType === 'multipart-form') warnings.add('postman-formdata-file');
  if (hasMeaningfulValue(parsed.settings)) warnings.add('bruno-settings-dropped');

  const body = mapOpenCollectionBody(bodyConfig);
  const request: ParsedCollectionRequest = {
    name: (title || `${rawMethod} ${url}`).slice(0, 120),
    method: rawMethod,
    url,
    headers,
    ...(body ? { body } : {}),
  };
  const preview: CollectionImporterPreview = {
    kind: 'http-collection',
    source: 'bruno',
    title: (title || 'Imported request').slice(0, 120),
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
      .filter(p => !p.disabled)
      .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');
    return content.length > 0 ? { kind, content } : undefined;
  }
  return { kind, content: trimmed };
}

export interface BrunoDirectoryFile {
  readonly relativePath: string;
  readonly content: string;
}

/**
 * Flatten a capability-scoped Bruno folder into the existing collection
 * preview. Metadata and environment files are filtered before this function;
 * each accepted request is still parsed independently so classic and
 * OpenCollection files may coexist during a migration.
 */
export function previewBrunoDirectory(
  collectionTitle: string,
  files: ReadonlyArray<BrunoDirectoryFile>
): ImporterPreviewOutcome<CollectionImporterPreview> {
  const requests: ParsedCollectionRequest[] = [];
  const warnings = new Set<ImporterLossyWarning>();
  const folders = new Set<string>();
  let recognized = 0;

  for (const file of files) {
    if (!detectBruno(file.content)) continue;
    recognized += 1;
    const outcome = previewBruno(file.content);
    if (!outcome.ok) return rejectBruno('directory-invalid-request');
    const parentParts = file.relativePath.split('/').slice(0, -1);
    const parent = parentParts.join('/');
    for (let depth = 1; depth <= parentParts.length; depth += 1) {
      folders.add(parentParts.slice(0, depth).join('/'));
    }
    for (const warning of outcome.warnings) warnings.add(warning);
    const request = outcome.preview.requests[0];
    if (request && requests.length < MAX_IMPORT_REQUESTS) {
      requests.push({
        ...request,
        name: (parent ? `${parent} / ${request.name}` : request.name).slice(0, 120),
      });
    }
  }

  if (recognized === 0) return rejectBruno('directory-empty');
  const preview: CollectionImporterPreview = {
    kind: 'http-collection',
    source: 'bruno',
    title: collectionTitle.trim().slice(0, 120) || 'Bruno collection',
    requests,
    counts: {
      total: requests.length,
      folders: folders.size,
      truncated: Math.max(0, recognized - requests.length),
    },
    warnings: [...warnings],
  };
  return { ok: true, preview, warnings: preview.warnings };
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
  import: preview => ({
    source: preview.source,
    title: preview.title,
    requests: preview.requests.map(r => ({
      ...r,
      headers: r.headers.map(h => ({ ...h })),
      ...(r.body ? { body: { ...r.body } } : {}),
    })),
  }),
};
