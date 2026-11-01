import { serializeScopeValue } from './scopeSnapshot';
import {
  forceTablePayload,
  formatPayloadInlineSummary,
  serializeRichValue,
  validateChartSpec,
  validateHtmlPayload,
  validateImageSrc,
  wrapAsRawText,
  type RichOutputPayload,
  type RichOutputProgress,
  type SerializeRichValueOptions,
} from './richOutput';

/** What `lingua.display(value, { as })` can force; anything else detects the type. */
const DISPLAY_AS = ['table', 'json', 'image', 'html', 'text', 'chart'] as const;
type DisplayAs = (typeof DISPLAY_AS)[number];

const PROGRESS_TEXT_CHARS = 80;

export type DisplayResult =
  | { payload: RichOutputPayload; text: string }
  | { rejected: { kind: 'chart' | 'image' | 'html'; reason: 'invalid-src' | 'size-limit' | 'validation-failed' }; text: string };

function displayAs(options: unknown): DisplayAs | null {
  const as = options && typeof options === 'object' ? (options as { as?: unknown }).as : undefined;
  return typeof as === 'string' && (DISPLAY_AS as readonly string[]).includes(as) ? (as as DisplayAs) : null;
}

function shown(payload: RichOutputPayload, fallback: string): DisplayResult {
  return { payload, text: formatPayloadInlineSummary(payload)?.display ?? fallback };
}

function image(value: unknown): DisplayResult {
  const raw = typeof value === 'string' ? { src: value } : ((value ?? {}) as { src?: unknown; mime?: unknown });
  const src = validateImageSrc(raw.src);
  if (src === null) return { rejected: { kind: 'image', reason: 'invalid-src' }, text: '[image rejected]' };
  const declared = typeof raw.mime === 'string' && raw.mime.length > 0 ? raw.mime : null;
  const mime = declared ?? /^data:(image\/[\w.+-]+)/.exec(src)?.[1] ?? 'image/png';
  return { payload: { kind: 'image', src, mime }, text: `[image ${mime}]` };
}

/**
 * The payload `lingua.display()` posts: detected from the value, or forced
 * with `{ as }`. HTML and charts only render when asked for by name.
 */
export function buildDisplayPayload(value: unknown, options?: unknown, serialize: SerializeRichValueOptions = {}): DisplayResult {
  const as = displayAs(options);
  switch (as) {
    case 'table':
      return shown(forceTablePayload(value, serialize), '[table]');
    case 'json':
      return shown(serializeScopeValue(value, { truncate: serialize.truncate ?? (input => input), errorStack: serialize.errorStack }), '[json]');
    case 'text': {
      const text = typeof value === 'string' ? value : String(value);
      return { payload: wrapAsRawText(text), text };
    }
    case 'image':
      return image(value);
    case 'html': {
      const html = validateHtmlPayload(value);
      if (html === null) {
        const reason = typeof value === 'string' && value.length > 0 ? 'size-limit' : 'validation-failed';
        return { rejected: { kind: 'html', reason }, text: '[html rejected]' };
      }
      return { payload: { kind: 'html', html }, text: '[html sandboxed]' };
    }
    case 'chart': {
      const spec = validateChartSpec(value);
      if (spec === null) return { rejected: { kind: 'chart', reason: 'validation-failed' }, text: '[chart rejected]' };
      return { payload: { kind: 'chart', spec }, text: '[chart]' };
    }
    default:
      if (typeof value === 'string') return value.startsWith('data:image/') ? image(value) : { payload: wrapAsRawText(value), text: value };
      return shown(serializeRichValue(value, serialize), '[display]');
  }
}

function clip(value: unknown): string {
  try {
    return String(value ?? '').slice(0, PROGRESS_TEXT_CHARS);
  } catch {
    return '';
  }
}

/** One progress bar's state; `value` is clamped to 0–1. */
export function buildProgressPayload(id: string, label: unknown, value: unknown, text?: unknown): RichOutputProgress {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const note = text === undefined || text === null ? '' : clip(text);
  return { kind: 'progress', id, label: clip(label), value: number, ...(note ? { text: note } : {}) };
}

/** Whole percent, rounded down so a bar only reads 100% once it is done. */
export function progressPercent(value: number): number {
  return Math.floor(value * 100);
}

/** The console line a progress bar shows as text. */
export function progressText(payload: RichOutputProgress): string {
  return `${payload.label} ${progressPercent(payload.value)}%${payload.text ? ` · ${payload.text}` : ''}`.trim();
}
