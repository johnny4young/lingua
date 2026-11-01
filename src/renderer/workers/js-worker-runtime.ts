import type { RichOutputPayload, RichOutputProgress } from '../../shared/richOutput';
import { validateChartSpec, validateHtmlPayload, validateImageSrc } from '../../shared/richOutput';
import { buildDisplayPayload, buildProgressPayload, progressPercent, progressText } from '../../shared/richDisplay';

/** A text-only progress change posts at most this often; a new whole percent always posts. */
const PROGRESS_TEXT_INTERVAL_MS = 50;
/** Further `progress()` calls in a run get a bar that draws nothing. */
const MAX_PROGRESS_BARS = 100;
const progressFlushes = new WeakMap<LinguaDisplay, () => void>();

/** Posts the notes progress bars were holding back, before the run reports done. */
export function flushLinguaProgress(bridge: { display?: LinguaDisplay }): void {
  if (bridge.display) progressFlushes.get(bridge.display)?.();
}

export interface LinguaProgressBar {
  update: (fraction: unknown, text?: unknown) => void;
}

export interface LinguaDisplay {
  (value: unknown, options?: unknown): void;
  progress: (label?: unknown) => LinguaProgressBar;
}

/**
 * `lingua` worker bridge factory. Returns the
 * `{ chart, image, html }` helpers user code calls inside the
 * AsyncFunction sandbox. Each helper:
 *
 *   1. Runs the matching `validate*` whitelist from `shared/richOutput`.
 *   2. On reject → posts a `console` message with a text fallback +
 *      a `richMediaRejected` flag. The JS / TS / Python runners all
 *      forward the flag to `runtime.rich_media_payload_rejected`.
 *   3. On accept → posts a `console` log with `args: [<rawText>]`
 *      and `payload: [<typed payload>]` so the renderer dispatches to
 *      the dedicated renderer component when one exists.
 *
 * The bridge is closure-scoped per execute() call so there's no
 * cross-run leak; cleanup is implicit when the AsyncFunction returns.
 */
export function buildLinguaWorkerBridge(
  context: Worker,
  runId: string,
  {
    callingLine = () => undefined,
    richDisplay = false,
    truncate = (text: string) => text,
  }: { callingLine?: () => number | undefined; richDisplay?: boolean; truncate?: (text: string) => string } = {}
): {
  chart: (spec: unknown) => void;
  image: (payload: unknown) => void;
  html: (html: unknown) => void;
  display?: LinguaDisplay;
} {
  const postRejection = (
    kind: 'chart' | 'image' | 'html',
    reason: 'invalid-src' | 'size-limit' | 'validation-failed',
    fallbackText: string
  ): void => {
    context.postMessage({
      type: 'console',
      runId,
      method: 'log',
      args: [fallbackText],
      richMediaRejected: { kind, reason },
    });
  };

  const postPayload = (payload: RichOutputPayload, fallbackText: string): void => {
    context.postMessage({
      type: 'console',
      runId,
      method: 'log',
      args: [fallbackText],
      payload: [payload],
    });
  };

  // Informative rejection text.
  // The bridge previously emitted a generic `[chart spec rejected]` /
  // `[image rejected: invalid source]` / `[html payload rejected]`
  // with no actionable context. Users couldn't tell whether they hit
  // the spec-security whitelist (data.url/data.name), the size cap,
  // a missing required field, or just a typo. The reasons below map
  // 1:1 to the closed-enum `RICH_MEDIA_REJECTED_REASONS` shipped on
  // the wire, so dashboards and humans see the same diagnosis.
  const rejectChart = (): void => {
    const reasonText = '[chart rejected: remote/named data not allowed (use data.values inline)]';
    postRejection('chart', 'validation-failed', reasonText);
  };
  const rejectImage = (reason: 'invalid-src' | 'validation-failed', detail?: string): void => {
    const reasonText =
      reason === 'invalid-src'
        ? '[image rejected: src must be data:image/, blob:, or https://]'
        : `[image rejected: ${detail ?? 'invalid payload (expected { src, mime })'}]`;
    postRejection('image', reason, reasonText);
  };
  const rejectHtml = (reason: 'size-limit' | 'validation-failed'): void => {
    const reasonText =
      reason === 'size-limit'
        ? '[html rejected: payload exceeds 256 KB cap]'
        : '[html rejected: expected a non-empty string]';
    postRejection('html', reason, reasonText);
  };

  const display = ((value: unknown, options?: unknown) => {
    const line = callingLine();
    const shown = buildDisplayPayload(value, options, { truncate });
    if ('rejected' in shown) {
      context.postMessage({ type: 'console', runId, method: 'log', args: [shown.text], richMediaRejected: shown.rejected, ...(line ? { line } : {}) });
      return;
    }
    context.postMessage({ type: 'console', runId, method: 'log', args: [shown.text], payload: [shown.payload], ...(line ? { line } : {}) });
  }) as LinguaDisplay;
  let bars = 0;
  const pending = new Map<string, () => void>();
  display.progress = label => {
    if (bars >= MAX_PROGRESS_BARS) return { update: () => {} };
    const id = `${runId}:progress-${(bars += 1)}`;
    const line = callingLine();
    let percent = -1;
    let note: string | undefined;
    let postedAt = 0;
    const send = (payload: RichOutputProgress) => {
      pending.delete(id);
      percent = progressPercent(payload.value);
      note = payload.text;
      postedAt = Date.now();
      context.postMessage({ type: 'console', runId, method: 'log', args: [progressText(payload)], payload: [payload], ...(line ? { line } : {}) });
    };
    const post = (fraction: unknown, text?: unknown) => {
      const payload = buildProgressPayload(id, label, fraction, text);
      if (progressPercent(payload.value) !== percent) return send(payload);
      if (payload.text === note) return;
      // A note that changes faster than the interval waits; the run's end flushes the last one.
      if (Date.now() - postedAt < PROGRESS_TEXT_INTERVAL_MS) pending.set(id, () => send(payload));
      else send(payload);
    };
    post(0);
    return { update: post };
  };
  progressFlushes.set(display, () => [...pending.values()].forEach(flush => flush()));

  return {
    ...(richDisplay ? { display } : {}),
    chart: spec => {
      const validated = validateChartSpec(spec);
      if (validated === null) {
        rejectChart();
        return;
      }
      postPayload({ kind: 'chart', spec: validated }, '[chart]');
    },
    image: raw => {
      if (!raw || typeof raw !== 'object') {
        rejectImage('validation-failed', 'expected { src, mime }');
        return;
      }
      const { src, mime } = raw as { src?: unknown; mime?: unknown };
      const validatedSrc = validateImageSrc(src);
      if (validatedSrc === null) {
        rejectImage('invalid-src');
        return;
      }
      const mimeString = typeof mime === 'string' && mime.length > 0 ? mime : 'image/png';
      postPayload({ kind: 'image', src: validatedSrc, mime: mimeString }, `[image ${mimeString}]`);
    },
    html: raw => {
      const validated = validateHtmlPayload(raw);
      if (validated === null) {
        const reason: 'size-limit' | 'validation-failed' =
          typeof raw === 'string' && raw.length > 0 ? 'size-limit' : 'validation-failed';
        rejectHtml(reason);
        return;
      }
      postPayload({ kind: 'html', html: validated }, '[html sandboxed]');
    },
  };
}
