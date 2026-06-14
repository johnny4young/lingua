/**
 * RL-110 Slice 1 — pure paste-intent detectors.
 *
 * When the user pastes into the Monaco editor, `useSmartPaste` reads the
 * pasted text and asks this module "is this a known Lingua artifact?". Each
 * detector is pure (string in -> intent | null out) and deliberately
 * CONSERVATIVE: when in doubt it returns null (the paste stays literal text)
 * rather than risk a false positive on the user's code. The detectors reuse
 * the already-shipped parsers (`parseRunCapsule`, `parseCurlCommand`,
 * `decodeShareFragment` prefix) so detection and the real import path agree.
 *
 * Detection runs in priority order (most specific first): a share-link
 * fragment, a RunCapsule JSON, a cURL command, a stack frame, then a generic
 * large JSON blob. The first match wins. The impure routing to the matching
 * importer lives in `applyPasteIntent.ts`; this module never touches Monaco,
 * stores, or i18n, so it is exhaustively unit-tested in isolation
 * (`tests/renderer/clipboard/pasteHandlers.test.ts`).
 */
import { parseRunCapsule } from '../../shared/runCapsule';
import { SHARE_FRAGMENT_PREFIX } from '../../shared/sharePayload';
import { parseCurlCommand } from '../utils/curlToCode';

/** Closed set of paste-intent kinds (mirrored in telemetry `handler`). */
export type PasteIntentKind =
  | 'share-link'
  | 'capsule'
  | 'curl'
  | 'stack-trace'
  | 'large-json';

/** A pasted Lingua share-link; `fragment` is the `share=v1.<body>` payload. */
export interface ShareLinkIntent {
  kind: 'share-link';
  /** The `share=v1.<base64url>` fragment, ready for `decodeShareFragment`. */
  fragment: string;
}

/** A pasted RunCapsuleV1 JSON document; `source` is the raw trimmed JSON. */
export interface CapsuleIntent {
  kind: 'capsule';
  source: string;
}

/** A pasted cURL command; `source` is the raw trimmed command text. */
export interface CurlIntent {
  kind: 'curl';
  source: string;
}

/**
 * A pasted stack trace's first resolvable frame. `file` may be an absolute
 * path, a `node:` internal, or null when the frame had no file token; the
 * router forwards it to the existing `lingua-open-file` event, which reveals
 * within-tab today and opens cross-file once RL-024 lands.
 */
export interface StackTraceIntent {
  kind: 'stack-trace';
  file: string | null;
  /** 1-based line from the frame. */
  line: number;
  /** 1-based column from the frame. */
  column: number;
}

/** A pasted generic JSON blob over {@link LARGE_JSON_MIN_BYTES}. */
export interface LargeJsonIntent {
  kind: 'large-json';
  source: string;
}

/** Discriminated union of every paste intent the registry can surface. */
export type PasteIntent =
  | ShareLinkIntent
  | CapsuleIntent
  | CurlIntent
  | StackTraceIntent
  | LargeJsonIntent;

/**
 * Minimum byte length for the generic large-JSON handler. Smaller JSON is
 * left as literal text — pasting a tiny object into a JS buffer is almost
 * always intentional code, not "open this as data".
 */
export const LARGE_JSON_MIN_BYTES = 1024;

/**
 * Share-link: the trimmed paste must be a single token (no internal
 * whitespace, so prose mentioning a link never fires) that carries the
 * `share=v1.` fragment with a non-empty body. Matches the real
 * `<origin><path>#share=v1.<body>` form copyShareLink produces, not the
 * aspirational `/s/<id>` short link.
 */
function detectShareLink(text: string): ShareLinkIntent | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || /\s/u.test(trimmed)) return null;
  const hashed = `#${SHARE_FRAGMENT_PREFIX}`;
  const hashIdx = trimmed.indexOf(hashed);
  const startIdx =
    hashIdx >= 0
      ? hashIdx + 1
      : trimmed.startsWith(SHARE_FRAGMENT_PREFIX)
        ? 0
        : -1;
  if (startIdx < 0) return null;
  const fragment = trimmed.slice(startIdx);
  if (fragment.length <= SHARE_FRAGMENT_PREFIX.length) return null;
  return { kind: 'share-link', fragment };
}

/**
 * Capsule: cheap `{`-prefix pre-check, then the real `parseRunCapsule` guard
 * (which hard-rejects `version !== 1` and malformed shapes). Reusing the
 * parser means detection can never disagree with the import.
 */
function detectCapsule(text: string): CapsuleIntent | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  return parseRunCapsule(trimmed).ok ? { kind: 'capsule', source: trimmed } : null;
}

/**
 * cURL: must START with `curl` + whitespace (so a JS string literal that
 * merely contains the word `curl` never fires) AND parse cleanly via the
 * shipped `parseCurlCommand`.
 */
function detectCurl(text: string): CurlIntent | null {
  const trimmed = text.trim();
  if (!/^curl\s/u.test(trimmed)) return null;
  return parseCurlCommand(trimmed).ok ? { kind: 'curl', source: trimmed } : null;
}

/**
 * Stack trace: the first Node-style frame `at [fn] (file:line:col)` or
 * `at file:line:col`. The `at ` anchor keeps a bare `:42:15` in prose from
 * matching. Browser `fn@url:line:col` frames are not parsed (rare in this
 * editor; conservative miss over a wrong jump).
 */
function detectStackTrace(text: string): StackTraceIntent | null {
  const match = text.match(/^\s*at\s+(?:.*?\()?([^()\s]+):(\d+):(\d+)\)?\s*$/m);
  if (!match) return null;
  const file = match[1] ?? null;
  const line = Number(match[2]);
  const column = Number(match[3]);
  if (!Number.isFinite(line) || !Number.isFinite(column)) return null;
  return { kind: 'stack-trace', file, line, column };
}

/**
 * Large JSON: a `{`/`[`-prefixed blob over {@link LARGE_JSON_MIN_BYTES} that
 * parses as JSON. Runs AFTER the capsule detector, so a RunCapsule never
 * reaches here — this is the catch-all for "open this data in a JSON tab".
 */
function detectLargeJson(text: string): LargeJsonIntent | null {
  const trimmed = text.trim();
  if (trimmed.length < LARGE_JSON_MIN_BYTES) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    JSON.parse(trimmed);
  } catch {
    return null;
  }
  return { kind: 'large-json', source: trimmed };
}

/**
 * Run every detector in priority order and return the first match, or null
 * when the paste is plain text. Order matters: share-link and capsule are the
 * most specific, large-JSON is the catch-all and must run last.
 */
export function detectPasteIntent(text: string): PasteIntent | null {
  if (!text || text.trim().length === 0) return null;
  return (
    detectShareLink(text) ??
    detectCapsule(text) ??
    detectCurl(text) ??
    detectStackTrace(text) ??
    detectLargeJson(text)
  );
}
