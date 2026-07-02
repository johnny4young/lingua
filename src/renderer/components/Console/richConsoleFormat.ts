/**
 * RL-044 Slice 1B — formatter helpers shared across the RichValue
 * components and the dispatch wrapper. Pure (no React, no i18n) so
 * the renderer-side `<ConsoleEntryRenderer>` and the popover surface
 * read the same shape from a single source.
 *
 * Mirrors the pattern from `<VariableInspectorPanel>`:
 *   - `typeIcon`  → single-character glyph per kind
 *   - `previewSummary` → compact preview for nested values
 *   - `richKindBucket` → the closed-enum bucket the telemetry emit
 *     uses (mirrored on `update-server/src/telemetry.ts`).
 *
 * Slice 1A's `formatPayloadInlineSummary` is reused for the
 * minimal "Table(N×M)" / "Map(N)" inline header text — the popover
 * adds deeper rendering on top of that.
 */

import type { ScopeValue } from '../../../shared/scopeSnapshot';
import type { RichOutputPayload } from '../../../shared/richOutput';
import type { ConsolePayloadKindBucket } from '../../types';

/**
 * Closed-enum bucket the `runtime.console_rich_rendered` telemetry
 * event accepts. Maps every payload kind to a small fixed set so we
 * never transmit unbounded discriminator names (Slice 2's chart /
 * image variants are pre-listed in `richOutput.ts`).
 */
export function richKindBucket(payload: RichOutputPayload): ConsolePayloadKindBucket {
  switch (payload.kind) {
    case 'table':
      return 'table';
    case 'map':
    case 'set':
      return 'mapSet';
    case 'date':
      return 'date';
    case 'promise':
      return 'promise';
    case 'rawText':
      return 'rawText';
    case 'image':
      return 'image';
    case 'chart':
      return 'chart';
    case 'object':
      return 'object';
    case 'array':
      return 'array';
    case 'error':
      // RL-044 Slice 1C fold F — Python `BaseException` payloads ship
      // `kind: 'error'` from `__lingua_console_serialize`. The renderer
      // already paints these via the warn/error type colour scheme;
      // bucketing them as `'error'` (not folded into `'text'`) keeps
      // the telemetry signal honest for dashboards counting error
      // payloads vs. plain text fallbacks.
      return 'error';
    case 'html':
      return 'html';
    case 'primitive':
    case 'function':
      return 'text';
  }
}

/** Single-character glyph per kind. Pure visual cue. */
export function typeIcon(payload: RichOutputPayload): string {
  switch (payload.kind) {
    case 'primitive':
      return '·';
    case 'function':
      return 'ƒ';
    case 'object':
      return '{}';
    case 'array':
      return '[]';
    case 'error':
      return '!';
    case 'map':
    case 'set':
      return '{}';
    case 'date':
      return '⌚';
    case 'promise':
      return '◌';
    case 'table':
      return '▦';
    case 'rawText':
      return '“”';
    case 'image':
      return '▣';
    case 'chart':
      return '◰';
    case 'html':
      return '⌗';
  }
}

/** Bounded preview for a `ScopeValue` (covers nested object/array cells). */
export function previewSummary(value: ScopeValue): string {
  switch (value.kind) {
    case 'primitive':
      return value.repr.length > 24 ? value.repr.slice(0, 24) + '…' : value.repr;
    case 'function':
      return 'ƒ';
    case 'object':
      return value.previewType + '{}';
    case 'array':
      return `[${value.length}]`;
    case 'error':
      return '!';
  }
}

/**
 * Detect entries whose payload kind has a richer dedicated
 * component. Anything that returns `false` here falls through to the
 * legacy text path in the dispatcher (still consuming `entry.content`
 * unchanged).
 */
export function payloadHasRichSurface(payload: RichOutputPayload): boolean {
  switch (payload.kind) {
    case 'table':
    case 'map':
    case 'set':
    case 'object':
    case 'array':
    case 'date':
    case 'promise':
    case 'rawText':
      return true;
    // primitive / function stay on the text path — they don't
    // benefit from popover expansion.
    case 'primitive':
    case 'function':
      return false;
    // RL-044 Slice 2a — `error` now opens the popover when the worker
    // attached a structured `stack`. The renderer's `<RichValueError>`
    // owns the chip; the popover surfaces the full traceback + raw
    // JSON tab.
    case 'error':
      return Array.isArray(payload.stack) && payload.stack.length > 0;
    // RL-044 Slice 2a — image + html have dedicated components.
    // RL-044 Slice 2b-β-α — chart now has a vega-embed renderer.
    case 'image':
    case 'html':
    case 'chart':
      return true;
  }
}

/** JSON.stringify the payload — never throws (cycles are excluded by the serializer). */
export function payloadAsJsonString(payload: RichOutputPayload): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    // Defensive — the payload is JSON-safe by construction
    // (`serializeRichValue` walks every value), so this branch should
    // be unreachable. Keeping the catch so a future widening of the
    // discriminator union cannot crash the popover.
    return String(payload);
  }
}

/**
 * Render a serialized `ScopeValue` (a rich-table cell, a Map/Set entry,
 * an object/array member) to a compact one-line string. Extracted from
 * the popover so the console grid AND the notebook cell table render
 * cells identically. Pure — no React, no i18n.
 */
export function scopeValueToString(value: ScopeValue): string {
  switch (value.kind) {
    case 'primitive':
      return value.repr;
    case 'function':
      return `ƒ ${value.name}`;
    case 'object': {
      const sample = value.entries
        .slice(0, 3)
        .map((entry) => `${entry.key}: …`)
        .join(', ');
      return `${value.previewType}{${sample}${value.entries.length > 3 ? ', …' : ''}}`;
    }
    case 'array': {
      const sample = value.entries
        .slice(0, 3)
        .map((entry) => {
          switch (entry.value.kind) {
            case 'primitive':
              return entry.value.repr;
            case 'function':
              return 'ƒ';
            case 'object':
              return entry.value.previewType + '{}';
            case 'array':
              return `[${entry.value.length}]`;
            case 'error':
              return '!';
          }
        })
        .join(', ');
      return `[${sample}${value.length > 3 ? ', …' : ''}]`;
    }
    case 'error':
      return value.message;
  }
}
