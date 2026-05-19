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
    case 'primitive':
    case 'function':
    case 'error':
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
    // primitive / function / error stay on the text path — they don't
    // benefit from popover expansion.
    case 'primitive':
    case 'function':
    case 'error':
      return false;
    // Slice 2 stubs — runners don't emit these today.
    case 'image':
    case 'chart':
      return false;
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
