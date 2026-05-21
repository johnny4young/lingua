/**
 * RL-044 Slice 1A — typed payloads for the structured console-entry
 * model.
 *
 * Today every value the user logs / peeks via `//=>` reaches the
 * renderer as a pre-stringified `string`. That coerces `Map`, `Set`,
 * `Date`, `Promise`, arrays of objects, and other structured shapes
 * into JSON / `[object Map]` / etc., losing the type information
 * the renderer needs to render them richly.
 *
 * This module ships the foundation: a discriminated union the
 * runners can emit instead of bare strings, an isomorphic serializer
 * the JS / TS workers (and a future Python worker) can call before
 * postMessage, and the auto-table heuristic the `//=>` magic-comment
 * runner uses to upgrade arrays of objects to a `kind: 'table'`
 * payload.
 *
 * Design choices:
 *
 *   - **Superset of `ScopeValue`.** `RichOutputPayload` literally
 *     reuses the five `ScopeValue` variants (primitive / function /
 *     object / array / error) so the formatters the variable
 *     inspector already ships (`typeTag`, `typeIcon`,
 *     `renderInlineValue`) cover the bulk of the rendering surface
 *     without a parallel codebase. The new variants
 *     (`map` / `set` / `date` / `promise` / `table` / `rawText`) are
 *     additive and only ever appear at the top level of a logged
 *     value — nested values inside a Map / Set / table cell stay
 *     `ScopeValue` for now. Lossy for `{ foo: new Map() }` but a
 *     graceful degradation (the inner Map renders as a
 *     `ScopeValueObject` with `previewType: 'Map'`).
 *   - **No React deps.** Stays under `src/shared/` so a future
 *     worker can `import { serializeRichValue }` without dragging
 *     in renderer code.
 *   - **Pre-stage Slice 2 stubs** (Fold E): the `image` and `chart`
 *     variants are reserved here with a TODO so Slice 2 doesn't
 *     have to migrate the discriminator union again.
 *
 * Out of scope this slice (deferred to Slice 1B / Slice 2):
 *   - Migrating `ConsoleOutput.args: string[]` to
 *     `RichOutputPayload[]` (breaking — touches every fixture).
 *   - `ConsolePanel` renderer dispatch.
 *   - Popover detail surface.
 *   - Image / HTML / chart rendering.
 *   - Python-side type detection for `pd.DataFrame`,
 *     `matplotlib.figure.Figure`.
 */

import type { ScopeValue } from './scopeSnapshot';
import { serializeScopeValue } from './scopeSnapshot';

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export interface RichOutputMap {
  kind: 'map';
  size: number;
  entries: Array<{ key: ScopeValue; value: ScopeValue }>;
  truncatedCount?: number;
}

export interface RichOutputSet {
  kind: 'set';
  size: number;
  entries: ScopeValue[];
  truncatedCount?: number;
}

export interface RichOutputDate {
  kind: 'date';
  /** ISO-8601 string. `'Invalid Date'` if the underlying Date was invalid. */
  iso: string;
}

export interface RichOutputPromise {
  kind: 'promise';
  state: 'pending' | 'resolved' | 'rejected';
  resolvedPreview?: ScopeValue;
}

export interface RichOutputTable {
  kind: 'table';
  columns: string[];
  rows: ScopeValue[][];
  /** Number of rows elided past the row cap (200). */
  truncatedRowCount?: number;
}

export interface RichOutputRawText {
  kind: 'rawText';
  text: string;
}

/**
 * Slice 2 stub (Fold E). Reserved so the discriminator union does
 * not need another migration when image rendering lands. No runner
 * emits this today.
 */
export interface RichOutputImage {
  kind: 'image';
  /** Resolved as `<img src=...>` after the Slice 2 sandbox lands. */
  src: string;
  mime: string;
}

/**
 * Slice 2 stub (Fold E). Chart-library choice (recharts vs
 * vega-lite) and the typed spec are deferred. No runner emits this
 * today.
 */
export interface RichOutputChart {
  kind: 'chart';
  spec: unknown;
}

/**
 * RL-044 Slice 2a — sandboxed HTML payload. Rendered inside an
 * `<iframe sandbox="allow-scripts">` (NO `allow-same-origin`) so
 * inline `<script>` cannot reach the parent window. `height` is an
 * optional clamp the worker can request; the renderer caps at
 * `MAX_HTML_PAYLOAD_HEIGHT_PX` regardless.
 */
export interface RichOutputHtml {
  kind: 'html';
  html: string;
  height?: number;
}

export type RichOutputPayload =
  | ScopeValue
  | RichOutputMap
  | RichOutputSet
  | RichOutputDate
  | RichOutputPromise
  | RichOutputTable
  | RichOutputRawText
  | RichOutputImage
  | RichOutputChart
  | RichOutputHtml;

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/** Rows surfaced per table payload. Past this, `truncatedRowCount` records the elision. */
export const MAX_TABLE_ROWS = 200;

/** Columns surfaced per table payload. Past this, columns are dropped silently. */
export const MAX_TABLE_COLUMNS = 16;

/** Per-Map / per-Set entry cap. */
export const MAX_MAP_ENTRIES = 100;
export const MAX_SET_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Identity / refinement helpers
// ---------------------------------------------------------------------------

const RICH_KINDS_BEYOND_SCOPE_VALUE = new Set([
  'map',
  'set',
  'date',
  'promise',
  'table',
  'rawText',
  'image',
  'chart',
  'html',
]);

/** RL-044 Slice 2a — renderer-side cap, enforced regardless of payload-requested height. */
export const MAX_HTML_PAYLOAD_HEIGHT_PX = 800;
/** RL-044 Slice 2a — default iframe height when the payload omits one. */
export const DEFAULT_HTML_PAYLOAD_HEIGHT_PX = 240;
/** RL-044 Slice 2a — maximum image source string length (~5 MB base64 ≈ 7 MB encoded). */
export const MAX_IMAGE_SRC_LENGTH = 7_000_000;
/** RL-044 Slice 2a — maximum HTML payload length the worker is allowed to ship (256 KB). */
export const MAX_HTML_PAYLOAD_LENGTH = 256 * 1024;
/** RL-044 Slice 2b-α — maximum inline `data.values` entries in a chart spec. */
export const MAX_CHART_DATA_VALUES = 5000;
/** RL-044 Slice 2b-α — maximum object / array nodes scanned in a chart spec. */
export const MAX_CHART_SPEC_NODES = 20_000;

// Five `ScopeValue` discriminants + the eight extended kinds = the
// full RichOutputPayload union. Centralised here so the type-guard,
// the refinement helpers, and any future dispatch switch stay in
// lockstep when Slice 2 widens the union.
const VALID_RICH_KINDS = new Set<string>([
  'primitive',
  'function',
  'object',
  'array',
  'error',
  ...RICH_KINDS_BEYOND_SCOPE_VALUE,
]);

export function isRichOutputPayload(value: unknown): value is RichOutputPayload {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  // Tighten the type-guard so unknown discriminants (typos, future
  // payloads from a stale worker) don't slip into a renderer switch
  // and crash exhaustiveness checks. The guarded callers can rely on
  // `kind` being one of the union's known discriminants.
  return typeof kind === 'string' && VALID_RICH_KINDS.has(kind);
}

/** `true` for every variant defined on top of `ScopeValue`. */
export function isExtendedRichKind(
  payload: RichOutputPayload
): payload is
  | RichOutputMap
  | RichOutputSet
  | RichOutputDate
  | RichOutputPromise
  | RichOutputTable
  | RichOutputRawText
  | RichOutputImage
  | RichOutputChart
  | RichOutputHtml {
  return RICH_KINDS_BEYOND_SCOPE_VALUE.has(payload.kind);
}

// ---------------------------------------------------------------------------
// Rich-media security validation (Slice 2a)
// ---------------------------------------------------------------------------

/**
 * RL-044 Slice 2a — `image` payload source validation. Accepts:
 *   - `data:image/...` URLs (worker-generated SVG / base64 PNG)
 *   - `blob:` URLs (canvas → blob roundtrip)
 *   - `https://` URLs only — `http://` is rejected to avoid mixed-content.
 *
 * Rejects `javascript:`, `vbscript:`, `file:`, and anything else.
 *
 * Returns the trimmed source on success, `null` when rejected.
 */
export function validateImageSrc(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_IMAGE_SRC_LENGTH) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:image/')) return trimmed;
  if (lower.startsWith('blob:')) return trimmed;
  if (lower.startsWith('https://')) return trimmed;
  return null;
}

/**
 * RL-044 Slice 2a — clamp the iframe height a `RichOutputHtml`
 * payload requests against the renderer-side cap.
 */
export function clampHtmlHeight(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_HTML_PAYLOAD_HEIGHT_PX;
  }
  return Math.min(Math.floor(requested), MAX_HTML_PAYLOAD_HEIGHT_PX);
}

/**
 * RL-044 Slice 2a — worker-side gate on the HTML payload string size.
 * Returns the html on success, `null` when empty / non-string /
 * over the cap.
 */
export function validateHtmlPayload(html: unknown): string | null {
  if (typeof html !== 'string') return null;
  if (html.length === 0) return null;
  if (html.length > MAX_HTML_PAYLOAD_LENGTH) return null;
  return html;
}

/**
 * RL-044 Slice 2b-α — chart spec security whitelist.
 *
 * Vega-lite specs support `data.url` and `data.name` references that
 * silently fetch external resources. Anti-feature §A-008 forbids
 * silent network calls from a console payload, so we reject any spec
 * whose `data` shape is anything other than inline `data.values`.
 *
 * Accepts, at any nested spec node:
 *   - object spec with `data.values: Array<unknown>` (≤ MAX_CHART_DATA_VALUES entries)
 *   - object spec WITHOUT `data` (treated as data-less — vega-lite supports it
 *     for `repeat` / `concat` parent specs, those compositions are allowed)
 *
 * Rejects:
 *   - non-object spec (string, null, array, etc.)
 *   - `data.url` (remote fetch)
 *   - `data.name` (reference to a named dataset — implies dataset is
 *     defined elsewhere, which our standalone serialization cannot
 *     guarantee is inline)
 *   - `data.values` length > MAX_CHART_DATA_VALUES (DoS guard)
 *
 * Returns the spec on accept, `null` on reject. Never mutates the input.
 */
export function validateChartSpec(spec: unknown): unknown | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  if (!validateChartSpecTree(spec)) {
    return null;
  }
  return spec;
}

function validateChartDataField(dataField: unknown): boolean {
  if (dataField === undefined || dataField === null) return true;
  if (!dataField || typeof dataField !== 'object' || Array.isArray(dataField)) {
    return false;
  }
  const data = dataField as Record<string, unknown>;
  try {
    if ('url' in data) return false;
    if ('name' in data) return false;
    if ('values' in data) {
      const values = data.values;
      if (!Array.isArray(values)) return false;
      if (values.length > MAX_CHART_DATA_VALUES) return false;
    }
  } catch {
    return false;
  }
  return true;
}

function validateChartSpecTree(root: object): boolean {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [root];
  let remaining = MAX_CHART_SPEC_NODES;

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) return false;
    if (remaining <= 0) return false;
    remaining -= 1;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) pending.push(item);
      continue;
    }

    const record = node as Record<string, unknown>;
    let dataField: unknown;
    let entries: Array<[string, unknown]>;
    try {
      dataField = record.data;
      entries = Object.entries(record);
    } catch {
      return false;
    }
    if (!validateChartDataField(dataField)) return false;
    for (const [key, value] of entries) {
      if (key === 'data') continue;
      pending.push(value);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Auto-table heuristic
// ---------------------------------------------------------------------------

/**
 * Detect "this value looks like a row-set we should render as a
 * table." Conservative on purpose — false positives turn small
 * scratch arrays into table widgets which the user didn't ask for.
 *
 * The heuristic requires:
 *   - the input is an array,
 *   - length ≥ 1,
 *   - every element is a plain object (constructor === Object or
 *     a null-prototype object — anything class-y is rejected),
 *   - the union of keys has size ≤ `MAX_TABLE_COLUMNS`,
 *   - at least one row carries a value, i.e. the union of keys is
 *     non-empty.
 *
 * Returns `null` when the input does not satisfy the heuristic.
 * Otherwise emits a `RichOutputTable` with cells already serialized
 * to `ScopeValue` so the renderer can iterate without a second
 * walker pass.
 */
export function detectAutoTable(value: unknown): RichOutputTable | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  for (const entry of value) {
    if (!isPlainObject(entry)) return null;
  }
  const columnSet = new Set<string>();
  for (const entry of value as Array<Record<string, unknown>>) {
    for (const key of Object.keys(entry)) {
      columnSet.add(key);
      if (columnSet.size > MAX_TABLE_COLUMNS) {
        // Heterogeneous-key blow-up — fall through to non-table.
        return null;
      }
    }
  }
  if (columnSet.size === 0) return null;
  const columns = Array.from(columnSet);
  const sliceCount = Math.min(value.length, MAX_TABLE_ROWS);
  const truncate = (input: string) => input;
  const rows: ScopeValue[][] = [];
  for (let rowIdx = 0; rowIdx < sliceCount; rowIdx += 1) {
    const row = value[rowIdx] as Record<string, unknown>;
    const cells: ScopeValue[] = columns.map((col) =>
      Object.prototype.hasOwnProperty.call(row, col)
        ? serializeScopeValue(row[col], { truncate, maxDepth: 1 })
        : { kind: 'primitive', type: 'undefined', repr: 'undefined' }
    );
    rows.push(cells);
  }
  const truncatedRowCount =
    value.length > sliceCount ? value.length - sliceCount : undefined;
  if (truncatedRowCount !== undefined) {
    return { kind: 'table', columns, rows, truncatedRowCount };
  }
  return { kind: 'table', columns, rows };
}

/**
 * Force a `RichOutputTable` regardless of input shape. Used by the
 * `//=> table` magic-comment directive and the future
 * `console.table()` shim — both signal "the user wants a table, do
 * the closest reasonable rendering."
 *
 *   - Array of plain objects → `detectAutoTable` (auto layout).
 *   - Array of primitives → one-column table keyed `'value'`.
 *   - Plain object → one-row table with the object's keys as columns.
 *   - Anything else → one-cell table keyed `'value'` carrying the
 *     serialized payload.
 */
export function forceTablePayload(value: unknown): RichOutputTable {
  const autoTable = detectAutoTable(value);
  if (autoTable) return autoTable;

  const truncate = (input: string) => input;

  if (Array.isArray(value)) {
    const sliceCount = Math.min(value.length, MAX_TABLE_ROWS);
    const rows: ScopeValue[][] = [];
    for (let rowIdx = 0; rowIdx < sliceCount; rowIdx += 1) {
      rows.push([serializeScopeValue(value[rowIdx], { truncate, maxDepth: 1 })]);
    }
    const truncatedRowCount =
      value.length > sliceCount ? value.length - sliceCount : undefined;
    const base: RichOutputTable = { kind: 'table', columns: ['value'], rows };
    if (truncatedRowCount !== undefined) {
      return { ...base, truncatedRowCount };
    }
    return base;
  }

  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, MAX_TABLE_COLUMNS);
    if (keys.length === 0) {
      return { kind: 'table', columns: [], rows: [] };
    }
    const row: ScopeValue[] = keys.map((key) =>
      serializeScopeValue(obj[key], { truncate, maxDepth: 1 })
    );
    return { kind: 'table', columns: keys, rows: [row] };
  }

  return {
    kind: 'table',
    columns: ['value'],
    rows: [[serializeScopeValue(value, { truncate, maxDepth: 1 })]],
  };
}

// ---------------------------------------------------------------------------
// Rich serializer
// ---------------------------------------------------------------------------

export interface SerializeRichValueOptions {
  /**
   * Truncation marker used when a long string is shortened. Defaults
   * to identity (no truncation) — the renderer-side cap applies on
   * top.
   */
  truncate?: (input: string) => string;
}

/**
 * Serialize a runtime value into a `RichOutputPayload` for transit
 * across the worker → runner → renderer boundary.
 *
 * Detection order (first match wins):
 *   1. Date  → `RichOutputDate`
 *   2. Map   → `RichOutputMap`
 *   3. Set   → `RichOutputSet`
 *   4. Array of plain objects → auto-table (`RichOutputTable`)
 *   5. Promise → `RichOutputPromise` with `state: 'pending'`
 *      (state introspection is intentionally not awaited — the
 *      runner cannot block on user code resolving its own promises)
 *   6. fallthrough → delegate to `serializeScopeValue`, returning a
 *      `ScopeValue` (which IS a valid `RichOutputPayload`).
 */
export function serializeRichValue(
  value: unknown,
  options: SerializeRichValueOptions = {}
): RichOutputPayload {
  const truncate = options.truncate ?? ((input: string) => input);

  if (value instanceof Date) {
    let iso: string;
    try {
      iso = value.toISOString();
    } catch {
      iso = 'Invalid Date';
    }
    return { kind: 'date', iso };
  }

  if (value instanceof Map) {
    const cap = Math.min(value.size, MAX_MAP_ENTRIES);
    const entries: Array<{ key: ScopeValue; value: ScopeValue }> = [];
    let consumed = 0;
    for (const [key, val] of value.entries()) {
      if (consumed >= cap) break;
      entries.push({
        key: serializeScopeValue(key, { truncate, maxDepth: 1 }),
        value: serializeScopeValue(val, { truncate, maxDepth: 1 }),
      });
      consumed += 1;
    }
    const truncatedCount = value.size > cap ? value.size - cap : undefined;
    if (truncatedCount !== undefined) {
      return { kind: 'map', size: value.size, entries, truncatedCount };
    }
    return { kind: 'map', size: value.size, entries };
  }

  if (value instanceof Set) {
    const cap = Math.min(value.size, MAX_SET_ENTRIES);
    const entries: ScopeValue[] = [];
    let consumed = 0;
    for (const item of value.values()) {
      if (consumed >= cap) break;
      entries.push(serializeScopeValue(item, { truncate, maxDepth: 1 }));
      consumed += 1;
    }
    const truncatedCount = value.size > cap ? value.size - cap : undefined;
    if (truncatedCount !== undefined) {
      return { kind: 'set', size: value.size, entries, truncatedCount };
    }
    return { kind: 'set', size: value.size, entries };
  }

  if (value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function') {
    // Conservative — never await the user's promise. The renderer
    // surfaces a "pending" badge today; a later slice could attach
    // a one-shot subscriber to flip the badge to resolved/rejected.
    return { kind: 'promise', state: 'pending' };
  }

  const autoTable = detectAutoTable(value);
  if (autoTable) return autoTable;

  return serializeScopeValue(value, { truncate });
}

// ---------------------------------------------------------------------------
// Compat wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a pre-stringified value as a `RichOutputPayload`. Used by
 * Python / Go / Rust runners (Slice 1B) that don't yet detect type
 * metadata — the compat wrapper keeps the discriminator union honest
 * without losing the existing rendering path.
 */
export function wrapAsRawText(text: string): RichOutputRawText {
  return { kind: 'rawText', text };
}

// ---------------------------------------------------------------------------
// JSON round-trip helpers (used by the runner to upgrade stringified
// magic-comment values into typed payloads when a directive opts in).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inline summary
// ---------------------------------------------------------------------------

/**
 * RL-044 Slice 1A — shared formatter that converts a payload into
 * a compact inline summary `{ display, kindLabel }`. Returns `null`
 * for payload kinds that don't have a meaningful inline shape
 * (callers fall back to the legacy stringified value + inferred
 * type pill).
 *
 * Centralised here so the editor-decoration path AND the overlay-
 * widget path render identical text. Both are React-free callers, so
 * the helper lives in `src/shared/` to keep the formula in one
 * place.
 */
export function formatPayloadInlineSummary(
  payload: RichOutputPayload
): { display: string; kindLabel: string } | null {
  switch (payload.kind) {
    case 'table': {
      const rowCount = payload.rows.length + (payload.truncatedRowCount ?? 0);
      const colCount = payload.columns.length;
      const colsLabel =
        payload.columns.length > 0 ? ` — ${payload.columns.join(', ')}` : '';
      return {
        display: `Table(${rowCount}×${colCount})${colsLabel}`,
        kindLabel: 'table',
      };
    }
    case 'map':
      return { display: `Map(${payload.size})`, kindLabel: 'map' };
    case 'set':
      return { display: `Set(${payload.size})`, kindLabel: 'set' };
    case 'date':
      return { display: payload.iso, kindLabel: 'date' };
    case 'promise':
      return {
        display: `Promise (${payload.state})`,
        kindLabel: 'promise',
      };
    // primitive / object / array / error / function / rawText / image /
    // chart intentionally fall through — the renderer either has a
    // richer dedicated widget (Slice 1B / Slice 2) or the legacy
    // stringified `value` already does a fine job inline.
    default:
      return null;
  }
}

/**
 * Best-effort JSON parse. Returns the parsed value on success and an
 * `ok: false` sentinel on failure so the caller can fall back to raw
 * text. Never throws.
 *
 * Accepts every valid JSON value at the top level — objects, arrays,
 * strings, numbers, `true`, `false`, `null`. The cheap shape gate
 * only filters obviously non-JSON shapes so we don't waste cycles
 * on console strings like `'hello world'`.
 */
export function tryParseJsonForPayload(
  input: string
): { ok: true; value: unknown } | { ok: false } {
  if (!input || typeof input !== 'string') return { ok: false };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false };
  const first = trimmed[0] ?? '';
  // Cheap shape gate — accepts every JSON-y first character including
  // the literal-keyword letters (`t`rue / `f`alse / `n`ull). Anything
  // else falls through to ok=false without paying for JSON.parse.
  if (
    first !== '{' &&
    first !== '[' &&
    first !== '"' &&
    first !== '-' &&
    first !== 't' &&
    first !== 'f' &&
    first !== 'n' &&
    (first < '0' || first > '9')
  ) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false };
  }
}

export type RichMediaMagicDirective = 'chart' | 'image' | 'html';

/**
 * RL-044 Slice 2b-beta — convert rich-media magic-comment values into
 * typed payloads. The JS worker serializes objects as JSON but strings
 * as bare text, so image/html directives must accept both parsed JSON
 * and the original raw string form.
 */
export function payloadForRichMediaMagicDirective(
  directive: RichMediaMagicDirective,
  value: string
): RichOutputPayload | undefined {
  if (directive === 'chart') {
    const parsed = tryParseJsonForPayload(value);
    if (!parsed.ok) return undefined;
    const validated = validateChartSpec(parsed.value);
    return validated === null ? undefined : { kind: 'chart', spec: validated };
  }

  const candidate = parseJsonOrRawString(value);
  if (directive === 'image') {
    return imagePayloadFromCandidate(candidate);
  }

  if (typeof candidate !== 'string') return undefined;
  const validated = validateHtmlPayload(candidate);
  return validated === null ? undefined : { kind: 'html', html: validated };
}

function parseJsonOrRawString(value: string): unknown {
  const parsed = tryParseJsonForPayload(value);
  return parsed.ok ? parsed.value : value;
}

function imagePayloadFromCandidate(candidate: unknown): RichOutputPayload | undefined {
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const { src, mime } = candidate as { src?: unknown; mime?: unknown };
    const validatedSrc = validateImageSrc(src);
    if (validatedSrc === null) return undefined;
    const mimeString =
      typeof mime === 'string' && mime.length > 0 ? mime : 'image/png';
    return { kind: 'image', src: validatedSrc, mime: mimeString };
  }

  if (typeof candidate !== 'string') return undefined;
  const validatedSrc = validateImageSrc(candidate);
  if (validatedSrc === null) return undefined;
  return { kind: 'image', src: validatedSrc, mime: 'image/png' };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value as object);
  return proto === null || proto === Object.prototype;
}
