/**
 * internal — build a redacted error report and copy it to the
 * clipboard from the error-boundary fallback UI.
 *
 * The report is intentionally minimal: enough for a support ticket
 * to triage the failure without exposing user code, file paths, or
 * stored secrets. Every stack frame is normalised to
 * `<asset>:line:col` (no absolute paths, no `file://` URLs, no user
 * folders).
 *
 * Pure module — no React, no Electron — so the boundary's
 * componentDidCatch can call it synchronously without dragging side
 * effects into the bundle.
 */

const APP_VERSION =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_LINGUA_APP_VERSION) ||
  '0.0.0';

export interface RedactedErrorReport {
  /** ISO 8601. */
  timestamp: string;
  /** Localized region label from the boundary, e.g. `editor`, `sidebar`. */
  region: string;
  /** Error.name, e.g. `TypeError`. */
  errorName: string;
  /** Error.message, truncated to 500 chars to avoid clipboard bloat. */
  errorMessage: string;
  /** Redacted stack — `<asset>:line:col` per frame, max 20 frames. */
  redactedStack: string;
  /** Build version for the support ticket. */
  appVersion: string;
  /** Coarse platform string. */
  platform: string;
  /** Active locale at the time of failure. */
  locale: string;
}

const ABSOLUTE_PATH_PATTERN =
  /(?:file:\/\/)?(?:\/(?:Users|home|tmp|var|opt|srv)\/[^\s:]*?\/|[A-Z]:\\(?:Users|Documents)\\[^\s:]*?\\)/giu;
const FILE_URL_PATTERN = /file:\/\/[^\s:]+/giu;
const QUERY_HASH_PATTERN = /[?#][^\s:)]+/giu;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._-]+/giu;
const LICENSE_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu;
const SECRET_QUERY_PATTERN =
  /([?&](?:token|license|licenseToken|key|secret|signature)=)[^\s&)]*/giu;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_FRAMES = 20;

export function redactSensitiveText(text: string): string {
  return text
    .replace(BEARER_TOKEN_PATTERN, 'Bearer <redacted>')
    .replace(LICENSE_TOKEN_PATTERN, '<redacted-token>')
    .replace(SECRET_QUERY_PATTERN, '$1<redacted>')
    .replace(FILE_URL_PATTERN, '<asset>')
    .replace(ABSOLUTE_PATH_PATTERN, '<asset>/')
    .replace(QUERY_HASH_PATTERN, '');
}

/**
 * Strip absolute filesystem paths and `file://` URLs from a stack
 * trace, leaving only the asset name and `line:col` coordinates.
 * Returns at most `MAX_STACK_FRAMES` lines.
 */
export function redactStack(stack: string): string {
  return stack
    .split('\n')
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => {
      let cleaned = redactSensitiveText(line);
      // Collapse any remaining absolute-looking prefixes onto <asset>.
      cleaned = cleaned.replace(/(?:\/\S+\/)([\w.-]+:\d+:\d+)/giu, '<asset>/$1');
      return cleaned;
    })
    .join('\n');
}

function safePlatform(): string {
  if (typeof navigator !== 'undefined' && typeof navigator.platform === 'string') {
    return navigator.platform.slice(0, 64);
  }
  return 'unknown';
}

function safeLocale(): string {
  if (typeof document !== 'undefined' && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en';
}

export function buildErrorReport(
  error: unknown,
  region: string,
  now: Date = new Date()
): RedactedErrorReport {
  const errorObj =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'unknown error');
  const truncatedMessage = redactSensitiveText(errorObj.message).slice(
    0,
    MAX_MESSAGE_LENGTH
  );
  const redacted = errorObj.stack ? redactStack(errorObj.stack) : '<no stack>';
  return {
    timestamp: now.toISOString(),
    region,
    errorName: errorObj.name || 'Error',
    errorMessage: truncatedMessage,
    redactedStack: redacted,
    appVersion: APP_VERSION,
    platform: safePlatform(),
    locale: safeLocale(),
  };
}

/**
 * Copy a JSON-serialised report to the clipboard. Tries the modern
 * Clipboard API first; falls back to a hidden `<textarea>` +
 * `document.execCommand('copy')` when the API is unavailable
 * (Electron `file://`, Permissions Policy denial, etc.). Returns
 * `true` on success.
 */
export async function copyErrorReportToClipboard(
  report: RedactedErrorReport,
  doc: Document = document
): Promise<boolean> {
  const text = `${JSON.stringify(report, null, 2)}\n`;

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or unsupported — fall through.
    }
  }

  return execCommandFallback(text, doc);
}

function execCommandFallback(text: string, doc: Document): boolean {
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = doc.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    doc.body.appendChild(textarea);
    textarea.select();
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea?.parentNode?.removeChild(textarea);
  }
}
