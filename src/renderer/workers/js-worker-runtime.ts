import type { RichOutputPayload } from '../../shared/richOutput';
import { validateChartSpec, validateHtmlPayload, validateImageSrc } from '../../shared/richOutput';
import { parseJsErrorStack } from '../../shared/errorStack';

/**
 * implementation — `lingua` worker bridge factory. Returns the
 * `{ chart, image, html }` helpers user code calls inside the
 * AsyncFunction sandbox. Each helper:
 *
 *   1. Runs the matching `validate*` whitelist from `shared/richOutput`.
 *   2. On reject → posts a `console` message with a text fallback +
 *      a `richMediaRejected` flag. Runner-side telemetry forwarding
 *      landed in implementation — JS / TS / Python runners all
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
  runId: string
): {
  chart: (spec: unknown) => void;
  image: (payload: unknown) => void;
  html: (html: unknown) => void;
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

  // implementation Prerequisite fix — informative rejection text.
  // The bridge previously emitted a generic `[chart spec rejected]` /
  // `[image rejected: invalid source]` / `[html payload rejected]`
  // with no actionable context. Users couldn't tell whether they hit
  // the spec-security whitelist (data.url/data.name), the size cap,
  // a missing required field, or just a typo. The reasons below map
  // 1:1 to the closed-enum `RICH_MEDIA_REJECTED_REASONS` shipped on
  // implementation, so dashboards and humans see the same diagnosis.
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

  return {
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

/**
 * Parse error to extract line/column from stack trace + structured
 * stack frames for the renderer's clickable-stack surface (internal
 * implementation).
 */
export function parseJsWorkerError(err: unknown): {
  message: string;
  line?: number;
  column?: number;
  stack?: string;
  frames?: import('../../shared/errorStack').ClickableStackFrame[];
} {
  if (!(err instanceof Error)) {
    return { message: String(err) };
  }

  const result: {
    message: string;
    line?: number;
    column?: number;
    stack?: string;
    frames?: import('../../shared/errorStack').ClickableStackFrame[];
  } = {
    message: err.message,
    stack: err.stack,
  };

  // Try to extract line/column from stack trace
  // Format: "at eval (eval at <anonymous> (:1:1), <anonymous>:LINE:COL)"
  // or:     "at <anonymous>:LINE:COL"
  if (err.stack) {
    const match = err.stack.match(/<anonymous>:(\d+):(\d+)/);
    const lineValue = match?.[1];
    const columnValue = match?.[2];
    if (lineValue && columnValue) {
      result.line = parseInt(lineValue, 10);
      result.column = parseInt(columnValue, 10);
    }
    // implementation — structured stack for the renderer's
    // `<RichValueError>` surface. Best-effort: unparseable frames stay
    // as text-only in the parsed array.
    const frames = parseJsErrorStack(err.stack);
    if (frames.length > 0) {
      result.frames = frames;
    }
  }

  return result;
}
