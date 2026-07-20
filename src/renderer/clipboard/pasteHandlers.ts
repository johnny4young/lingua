/**
 * implementation — pure paste-intent detectors.
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
import {
  decodeBase64,
  detectsAsBase64,
  detectsAsColor,
  detectsAsCron,
  detectsAsJson,
  detectsAsJwt,
  detectsAsUuid,
} from '../utils/developerUtilities';

/**
 * Closed set of paste-intent kinds. Telemetry `handler` mirrors these,
 * except `utility`, which reports per-format as `utility-<utilityId>`
 * (see `SMART_PASTE_HANDLERS` in `src/shared/telemetry.ts`).
 */
export type PasteIntentKind =
  | 'share-link'
  | 'capsule'
  | 'curl'
  | 'stack-trace'
  | 'large-json'
  | 'utility';

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
 * router forwards it to the existing `file.open` command, which reveals
 * within-tab today and opens cross-file once internal lands.
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

/**
 * internal — Developer Utilities the paste router can suggest. Values are
 * catalog ids from `data/developerUtilities.ts`, narrowed to the formats
 * with a conservative single-value detector.
 */
export type UtilitySuggestionId =
  | 'jwt'
  | 'uuid'
  | 'color'
  | 'timestamp'
  | 'cron-parser'
  | 'base64'
  | 'json';

/**
 * internal — a pasted value a Developer Utility can handle better than the
 * code buffer (a JWT, a UUID, a color, an epoch, a cron expression,
 * Base64 text, or a small JSON snippet). `source` is the trimmed paste,
 * pre-loaded into the panel when the user accepts.
 */
export interface UtilityIntent {
  kind: 'utility';
  utilityId: UtilitySuggestionId;
  source: string;
}

/** Discriminated union of every paste intent the registry can surface. */
export type PasteIntent =
  | ShareLinkIntent
  | CapsuleIntent
  | CurlIntent
  | StackTraceIntent
  | LargeJsonIntent
  | UtilityIntent;

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
  const startIdx = hashIdx >= 0 ? hashIdx + 1 : trimmed.startsWith(SHARE_FRAGMENT_PREFIX) ? 0 : -1;
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
 * internal — utility suggestions. Pastes longer than this never suggest a
 * utility: the formats below are short values, and analyzing a huge paste
 * on the paste path is wasted work.
 */
export const UTILITY_SUGGESTION_MAX_CHARS = 10_000;

/**
 * Bare 3/6-digit hex REQUIRES the leading `#`. `detectsAsColor` accepts
 * `4f46e5` without it, but an un-prefixed hex token pasted into code is
 * far more often an id fragment or a hash than a color.
 */
const STRICT_HEX_COLOR = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/u;
const COLOR_FUNCTION = /^(?:rgba?|hsla?)\([^()]*\)$/iu;

/** Epoch seconds (10 digits) or milliseconds (13 digits) — nothing else. */
const EPOCH_DIGITS = /^\d{10}(?:\d{3})?$/u;

/**
 * Base64 shorter than this stays literal — 4-to-12-char identifiers in
 * code match the Base64 charset constantly, and decoding them is never
 * what the user wants.
 */
const MIN_BASE64_SUGGESTION_CHARS = 16;

/**
 * JSON shorter than this stays literal — a tiny strict-JSON object pasted
 * into a code buffer is usually meant as code, and a formatter adds
 * nothing to it. Blobs over `LARGE_JSON_MIN_BYTES` never reach here (the
 * large-json detector wins first).
 */
const MIN_JSON_SUGGESTION_CHARS = 60;

/**
 * Per-position numeric bounds for 5/6/7-field cron expressions. The shape
 * regex in `detectsAsCron` also matches arithmetic like `5 * 60 * 1000`
 * (a hallmark JS duration constant), so every numeric atom must respect
 * its field's range before we dare suggest the Cron Parser. The real
 * parser is async (lazy cron-parser import) and cannot run on the
 * synchronous paste path; these bounds are the sync subset that kills
 * the arithmetic look-alikes.
 */
const CRON_FIELD_BOUNDS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  5: [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ],
  6: [
    [0, 59],
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ],
  7: [
    [0, 59],
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
    [1970, 2099],
  ],
};

function cronAtomInBounds(atom: string, min: number, max: number): boolean {
  // Strip a trailing `/step`; the step itself just has to be a number.
  const [base = '', step] = atom.split('/', 2);
  if (step !== undefined && !/^\d+$/u.test(step)) return false;
  if (base === '*' || base === '?' || base === 'L') return true;
  // dow `5#3` (third Friday) — bounds-check the day part.
  const hashBase = base.split('#', 1)[0] ?? base;
  const range = hashBase.split('-', 2);
  return range.every(part => {
    if (part === '' || part === 'L') return part === 'L';
    if (!/^\d+$/u.test(part)) return false;
    const value = Number.parseInt(part, 10);
    return value >= min && value <= max;
  });
}

function cronFieldsInBounds(trimmed: string): boolean {
  if (trimmed.startsWith('@')) return true;
  const fields = trimmed.split(/\s+/u);
  const bounds = CRON_FIELD_BOUNDS[fields.length];
  if (!bounds) return false;
  return fields.every((field, index) => {
    const [min, max] = bounds[index]!;
    return field.split(',').every(atom => cronAtomInBounds(atom, min, max));
  });
}

/**
 * Mirrors `inspectTimestampLike`'s human-range clamp: an epoch outside
 * 2000–2100 is far more likely an arbitrary numeric constant.
 */
function isHumanEpoch(digits: string): boolean {
  const numeric = Number.parseInt(digits, 10);
  const milliseconds = digits.length === 10 ? numeric * 1000 : numeric;
  const year = new Date(milliseconds).getUTCFullYear();
  return year >= 2000 && year <= 2100;
}

/**
 * A Base64 suggestion is only useful when the decode yields readable
 * text. Random identifiers and hex hashes that happen to satisfy the
 * Base64 shape decode to binary garbage — a replacement char or a bare
 * control char means "leave it alone".
 */
function decodesToReadableText(value: string): boolean {
  const decoded = decodeBase64(value);
  if (decoded.errorKey !== null || !decoded.value) return false;
  if (decoded.value.includes('�')) return false;
  for (const char of decoded.value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t') return false;
  }
  return true;
}

/**
 * internal — map a paste to the Developer Utility that handles it, or null.
 * Runs LAST in the chain, so every internal code-like artifact (share-link,
 * capsule, cURL, stack trace, large JSON) wins first. Within the family,
 * JWT precedes Base64 (JWT segments are themselves base64url) and every
 * check is single-value strict so ordinary code never matches.
 */
function detectUtilitySuggestion(text: string): UtilityIntent | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > UTILITY_SUGGESTION_MAX_CHARS) return null;
  const singleToken = !/\s/u.test(trimmed);
  const singleLine = !/[\r\n]/u.test(trimmed);

  const utilityId = ((): UtilitySuggestionId | null => {
    if (singleToken && detectsAsJwt(trimmed)) return 'jwt';
    if (singleToken && detectsAsUuid(trimmed)) return 'uuid';
    if (
      (STRICT_HEX_COLOR.test(trimmed) || COLOR_FUNCTION.test(trimmed)) &&
      detectsAsColor(trimmed)
    ) {
      return 'color';
    }
    if (singleToken && EPOCH_DIGITS.test(trimmed) && isHumanEpoch(trimmed)) return 'timestamp';
    if (singleLine && detectsAsCron(trimmed) && cronFieldsInBounds(trimmed)) {
      return 'cron-parser';
    }
    if (
      singleToken &&
      trimmed.length >= MIN_BASE64_SUGGESTION_CHARS &&
      detectsAsBase64(trimmed) &&
      decodesToReadableText(trimmed)
    ) {
      return 'base64';
    }
    if (trimmed.length >= MIN_JSON_SUGGESTION_CHARS && detectsAsJson(trimmed)) return 'json';
    return null;
  })();

  return utilityId ? { kind: 'utility', utilityId, source: trimmed } : null;
}

/**
 * Run every detector in priority order and return the first match, or null
 * when the paste is plain text. Order matters: share-link and capsule are the
 * most specific, large-JSON is the JSON catch-all, and the internal utility
 * suggestions run last so they can never shadow an importer.
 */
export function detectPasteIntent(text: string): PasteIntent | null {
  if (!text || text.trim().length === 0) return null;
  return (
    detectShareLink(text) ??
    detectCapsule(text) ??
    detectCurl(text) ??
    detectStackTrace(text) ??
    detectLargeJson(text) ??
    detectUtilitySuggestion(text)
  );
}
