import type { LineResult } from '../../stores/resultStore';
import { formatPayloadInlineSummary } from '../../../shared/richOutput';

const INLINE_VALUE_MAX_CHARS = 80;
const INLINE_VALUE_ELLIPSIS = '…';

function truncateInlineValue(value: string): { display: string; truncated: boolean } {
  if (value.length <= INLINE_VALUE_MAX_CHARS) {
    return { display: value, truncated: false };
  }
  return {
    display: `${value.slice(0, INLINE_VALUE_MAX_CHARS - 1)}${INLINE_VALUE_ELLIPSIS}`,
    truncated: true,
  };
}

/**
 * Cheap type inference over the displayed string. Mirrors the
 * heuristic used in the Stdin queue + Variables card. We can't know
 * the runtime type without re-parsing the host language; this fallback
 * is good enough to colour the type pill consistently.
 */
function inferKind(raw: string | undefined): string {
  if (raw === undefined || raw === '') return 'string';
  const s = raw.trim();
  if (s === 'true' || s === 'false') return 'boolean';
  if (s === 'undefined') return 'undefined';
  if (s === 'null') return 'null';
  if (/^-?\d+(\.\d+)?$/.test(s)) return 'number';
  if (s.startsWith('[') && s.endsWith(']')) return 'array';
  if (s.startsWith('{') && s.endsWith('}')) return 'object';
  if (s.startsWith('"') || s.startsWith("'")) return 'string';
  return 'string';
}

/**
 * Build the DOM node for a single line's inline-result widget.
 * The HTML follows the v2 mock: drop-arrow (⟸) · value · type pill ·
 * latency · 📌 / @WATCH where appropriate. Pure DOM (no React mount)
 * because overlay widgets re-use the same node across layouts and
 * mounting a React tree per line would be expensive.
 */
export function renderInlineResultNode(
  items: readonly LineResult[],
  timing?: { durationMs: number; slowest: boolean }
): HTMLElement {
  const root = document.createElement('span');
  root.className = 'lingua-inline-result';
  root.setAttribute('data-testid', 'lingua-inline-result');

  // implementation follow-up — cap rendered items per line so a
  // Python SyntaxError that ships 4+ console messages tagged to the
  // same line (or a hot loop with multiple prints) doesn't pile up
  // horizontally and visually overrun the editor. The dropped count
  // surfaces as a discreet "+N more" hint at the tail.
  const INLINE_MAX_ITEMS_PER_LINE = 3;
  const visibleItems = items.slice(0, INLINE_MAX_ITEMS_PER_LINE);
  const droppedItems = items.length - visibleItems.length;

  for (let i = 0; i < visibleItems.length; i += 1) {
    const result = visibleItems[i];
    if (!result) continue;
    const isWatch = result.type === 'watch';
    // implementation — when the runner attached a typed payload,
    // upgrade the pill via the shared formatter so the editor-
    // decoration path and this overlay-widget path stay byte-for-
    // byte identical. Falls back to the legacy stringified value +
    // inferred kind when there's no payload (every legacy
    // code path keeps its rendering).
    const richPreview = result.payload ? formatPayloadInlineSummary(result.payload) : null;
    const valueStr = richPreview ? richPreview.display : String(result.value ?? '');
    const kind =
      result.type === 'error'
        ? 'error'
        : richPreview
          ? richPreview.kindLabel
          : inferKind(valueStr);
    const part = document.createElement('span');
    part.className = 'lingua-inline-result-part';
    part.setAttribute('data-result-kind', result.type);

    if (isWatch) {
      const badge = document.createElement('span');
      badge.className = 'lingua-inline-result-watch';
      badge.textContent = '@WATCH';
      part.appendChild(badge);
    }

    const arrow = document.createElement('span');
    arrow.className = 'lingua-inline-result-arrow';
    arrow.textContent = '⟸';
    part.appendChild(arrow);

    const value = document.createElement('span');
    value.className = 'lingua-inline-result-value';
    // Prerequisite fix (internal overflow): cap the rendered string so
    // the overlay widget never overruns the editor viewport. The
    // legacy `//=>` arrow on a large array used to paint past the
    // gutter; this keeps the pill inside the editor padding. Rich
    // payloads (table / map / set / date / promise) ship a summary
    // shorter than the cap so the truncation is a no-op for them.
    const truncated = truncateInlineValue(valueStr);
    value.textContent = truncated.display;
    if (truncated.truncated) {
      value.setAttribute('title', valueStr);
      value.setAttribute('data-truncated', 'true');
    }
    part.appendChild(value);

    const pill = document.createElement('span');
    pill.className = 'lingua-inline-result-pill';
    pill.setAttribute('data-type-pill', kind);
    pill.textContent = kind;
    part.appendChild(pill);

    root.appendChild(part);
    if (i < visibleItems.length - 1) {
      const dot = document.createElement('span');
      dot.className = 'lingua-inline-result-separator';
      dot.textContent = '·';
      root.appendChild(dot);
    }
  }

  if (droppedItems > 0) {
    const overflow = document.createElement('span');
    overflow.className = 'lingua-inline-result-overflow';
    overflow.setAttribute('data-testid', 'lingua-inline-result-overflow');
    overflow.textContent = `+${droppedItems} more`;
    root.appendChild(overflow);
  }

  // internal — trailing per-statement timing chip. The slowest line of
  // the run carries `data-slowest` so the stylesheet can paint the hot
  // spot red while every other measurement stays a quiet italic gray.
  if (timing) {
    const chip = document.createElement('span');
    chip.className = 'lingua-inline-result-timing';
    chip.setAttribute('data-testid', 'lingua-inline-timing');
    if (timing.slowest) chip.setAttribute('data-slowest', 'true');
    chip.textContent = `\u25b8 ${formatTimingMs(timing.durationMs)}`;
    root.appendChild(chip);
  }

  return root;
}

/**
 * internal — compact duration label. Mirrors the notebook's
 * `formatLatencyMs`: sub-100ms keeps one decimal so quick statements
 * do not all read as `0 ms`; everything else rounds to whole ms.
 */
function formatTimingMs(durationMs: number): string {
  const value = durationMs >= 100 ? Math.round(durationMs).toString() : durationMs.toFixed(1);
  return `${value} ms`;
}
