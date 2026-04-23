/**
 * RL-068 — Backslash Escape / Unescape helper.
 *
 * Pure, offline, renderer-side. Handles four language presets:
 * `javascript`, `json`, `python`, `sql-mysql`. Each preset ships its own
 * escape map (which raw chars become which escape sequence) and its own
 * unescape state machine (which sequences are recognized, how numeric
 * escapes are bounded).
 *
 * No DOM, no external dependency — this module is a pure state machine
 * walker, so it runs identically in the Electron renderer, the web build,
 * and vitest's jsdom setup.
 *
 * The unescape direction returns a tagged-union result: `{ ok: true,
 * output }` on success, `{ ok: false, kind: 'malformed-escape', position,
 * reason }` on structural error so the panel can surface a translated
 * message with the offending position.
 */

export type BackslashPreset = 'javascript' | 'json' | 'python' | 'sql-mysql';

/**
 * Closed enum of structural reasons an unescape can fail. The UI maps each
 * one to a translated message; tests pin the enum so callers know the
 * exhaustive set.
 */
export type UnescapeReason =
  | 'expected-two-hex-digits'
  | 'expected-four-hex-digits'
  | 'expected-eight-hex-digits'
  | 'expected-octal-digits'
  | 'truncated-unicode-braces'
  | 'unknown-escape'
  | 'trailing-backslash';

export type UnescapeResult =
  | { ok: true; output: string }
  | {
      ok: false;
      kind: 'malformed-escape';
      position: number;
      reason: UnescapeReason;
    };

/**
 * Closed set of "special" chars each preset knows how to re-encode. Every
 * other char passes through verbatim. ASCII printable range outside these
 * maps is always emitted as-is; non-ASCII BMP + astral codepoints only get
 * escaped when the preset's `escapeNonAscii` flag is true (JSON only).
 */
interface PresetConfig {
  /** Map from raw char → escape sequence body (after the leading backslash). */
  readonly escapeMap: Readonly<Record<string, string>>;
  /** Whether to emit non-ASCII codepoints as \uHHHH (JSON-style). */
  readonly escapeNonAscii: boolean;
  /** Whether the preset supports \xHH hex-byte escapes. */
  readonly supportsHexByte: boolean;
  /** Whether the preset supports \u{…} brace-wrapped codepoint escapes. */
  readonly supportsUnicodeBraces: boolean;
  /** Whether the preset supports \UHHHHHHHH (Python 8-digit unicode). */
  readonly supportsLongUnicode: boolean;
  /** Whether the preset supports \ooo octal (1-3 digits). */
  readonly supportsOctal: boolean;
  /**
   * Sequences the unescaper recognizes as "simple" (single char after the
   * backslash → single decoded char). Mirrors but does not strictly equal
   * `escapeMap` — e.g. JS accepts `\v` but \v is also in escapeMap.
   */
  readonly simpleEscapes: Readonly<Record<string, string>>;
}

const JS_SIMPLE: Readonly<Record<string, string>> = Object.freeze({
  '0': '\0',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '`': '`',
  '/': '/',
});

const JSON_SIMPLE: Readonly<Record<string, string>> = Object.freeze({
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  '\\': '\\',
  '"': '"',
  '/': '/',
});

const PY_SIMPLE: Readonly<Record<string, string>> = Object.freeze({
  '0': '\0',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
});

// `\Z` (0x1A) is a MySQL extension — emitted for a literal 0x1A char.
const SQL_SIMPLE: Readonly<Record<string, string>> = Object.freeze({
  '0': '\0',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\x1a',
  '\\': '\\',
  "'": "'",
  '"': '"',
});

const JS_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '\0': '0',
  '\b': 'b',
  '\f': 'f',
  '\n': 'n',
  '\r': 'r',
  '\t': 't',
  '\v': 'v',
  '\\': '\\',
  "'": "'",
  '"': '"',
});

const JSON_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '\b': 'b',
  '\f': 'f',
  '\n': 'n',
  '\r': 'r',
  '\t': 't',
  '\\': '\\',
  '"': '"',
});

const PY_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '\0': '0',
  '\x07': 'a',
  '\b': 'b',
  '\f': 'f',
  '\n': 'n',
  '\r': 'r',
  '\t': 't',
  '\v': 'v',
  '\\': '\\',
  "'": "'",
  '"': '"',
});

const SQL_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '\0': '0',
  '\b': 'b',
  '\n': 'n',
  '\r': 'r',
  '\t': 't',
  '\x1a': 'Z',
  '\\': '\\',
  "'": "'",
  '"': '"',
});

const PRESETS: Readonly<Record<BackslashPreset, PresetConfig>> = Object.freeze({
  javascript: {
    escapeMap: JS_ESCAPE_MAP,
    escapeNonAscii: false,
    supportsHexByte: true,
    supportsUnicodeBraces: true,
    supportsLongUnicode: false,
    supportsOctal: false,
    simpleEscapes: JS_SIMPLE,
  },
  json: {
    escapeMap: JSON_ESCAPE_MAP,
    escapeNonAscii: true,
    supportsHexByte: false,
    supportsUnicodeBraces: false,
    supportsLongUnicode: false,
    supportsOctal: false,
    simpleEscapes: JSON_SIMPLE,
  },
  python: {
    escapeMap: PY_ESCAPE_MAP,
    escapeNonAscii: false,
    supportsHexByte: true,
    supportsUnicodeBraces: false,
    supportsLongUnicode: true,
    supportsOctal: true,
    simpleEscapes: PY_SIMPLE,
  },
  'sql-mysql': {
    escapeMap: SQL_ESCAPE_MAP,
    escapeNonAscii: false,
    supportsHexByte: false,
    supportsUnicodeBraces: false,
    supportsLongUnicode: false,
    supportsOctal: false,
    simpleEscapes: SQL_SIMPLE,
  },
});

function isHexDigit(char: string): boolean {
  return /^[0-9a-fA-F]$/u.test(char);
}

function isOctalDigit(char: string): boolean {
  return char >= '0' && char <= '7';
}

/**
 * Encode control chars that don't have a named escape in the active preset
 * as a numeric escape (`\xHH` or `\uHHHH`). This keeps escape output ASCII-
 * safe across all presets — otherwise a raw `\x01` in the input would
 * round-trip as itself (invisible) instead of a visible escape sequence.
 */
function encodeControlChar(code: number, preset: PresetConfig): string {
  if (preset.supportsHexByte && code <= 0xff) {
    return `\\x${code.toString(16).padStart(2, '0').toUpperCase()}`;
  }
  // Fall back to \uHHHH so the output is still visibly escaped.
  return `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
}

/**
 * Escape every character in `text` under the given preset's rules. Emits
 * named escapes for the char-map entries, numeric escapes for otherwise-
 * unprintable control chars, and passes regular printable ASCII through
 * verbatim. JSON additionally escapes non-ASCII codepoints via \uHHHH
 * (with surrogate pair decomposition) so the output is valid JSON string
 * content.
 */
export function escapeWithPreset(text: string, presetId: BackslashPreset): { ok: true; output: string } {
  const preset = PRESETS[presetId];
  const out: string[] = [];

  // We iterate UTF-16 code units (via for..of would yield codepoints — we
  // want units so surrogate pairs can be emitted as \uD83D\uDE00 for the
  // JSON preset).
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    const mapped = preset.escapeMap[char];
    if (mapped !== undefined) {
      out.push('\\', mapped);
      continue;
    }
    const code = char.charCodeAt(0);
    // Control chars (< 0x20) that aren't in the map → numeric escape.
    if (code < 0x20) {
      out.push(encodeControlChar(code, preset));
      continue;
    }
    // DEL + C1 controls as numeric escapes too.
    if (code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      out.push(encodeControlChar(code, preset));
      continue;
    }
    // JSON: escape non-ASCII as \uHHHH (valid JSON string content).
    if (preset.escapeNonAscii && code > 0x7e) {
      out.push('\\u', code.toString(16).padStart(4, '0').toUpperCase());
      continue;
    }
    out.push(char);
  }
  return { ok: true, output: out.join('') };
}

interface HexReadResult {
  value: number;
  consumed: number;
}

/** Read exactly `count` hex digits starting at `offset`. Returns null on short read. */
function readHex(source: string, offset: number, count: number): HexReadResult | null {
  let value = 0;
  for (let i = 0; i < count; i += 1) {
    const char = source[offset + i];
    if (char === undefined || !isHexDigit(char)) {
      return null;
    }
    value = value * 16 + parseInt(char, 16);
  }
  return { value, consumed: count };
}

/** Read hex digits between `\u{` and `}`. Returns null on missing `}` / empty body / overflow. */
function readBracedHex(source: string, offset: number): HexReadResult | null {
  let end = offset;
  let digits = '';
  while (end < source.length && source[end] !== '}') {
    const char = source[end] ?? '';
    if (!isHexDigit(char)) return null;
    digits += char;
    end += 1;
    if (digits.length > 6) return null; // max Unicode codepoint is 6 hex digits.
  }
  if (source[end] !== '}' || digits.length === 0) return null;
  const value = parseInt(digits, 16);
  if (value > 0x10ffff) return null;
  // +1 for the closing `}`.
  return { value, consumed: digits.length + 1 };
}

/** Read 1-3 octal digits starting at `offset`. Always succeeds if at least one digit. */
function readOctal(source: string, offset: number): HexReadResult | null {
  let digits = '';
  let end = offset;
  while (end < source.length && digits.length < 3 && isOctalDigit(source[end] ?? '')) {
    digits += source[end];
    end += 1;
  }
  if (digits.length === 0) return null;
  return { value: parseInt(digits, 8), consumed: digits.length };
}

/**
 * Decode every escape sequence in `text` under the given preset's rules.
 * Unknown sequences return a structured `malformed-escape` error so the
 * panel can point to the offending position. Lenient sequences (e.g. a
 * backslash before an ordinary letter in JS) are treated as errors: better
 * to surface an unknown escape than silently drop the backslash.
 */
export function unescapeWithPreset(text: string, presetId: BackslashPreset): UnescapeResult {
  const preset = PRESETS[presetId];
  const out: string[] = [];
  let i = 0;
  const length = text.length;

  while (i < length) {
    const char = text[i] ?? '';
    if (char !== '\\') {
      out.push(char);
      i += 1;
      continue;
    }
    // char === '\\'
    if (i + 1 >= length) {
      return { ok: false, kind: 'malformed-escape', position: i, reason: 'trailing-backslash' };
    }
    const next = text[i + 1] ?? '';

    // Simple single-char escapes first.
    const simple = preset.simpleEscapes[next];
    if (simple !== undefined) {
      out.push(simple);
      i += 2;
      continue;
    }

    // \xHH
    if (next === 'x' && preset.supportsHexByte) {
      const read = readHex(text, i + 2, 2);
      if (read === null) {
        return { ok: false, kind: 'malformed-escape', position: i, reason: 'expected-two-hex-digits' };
      }
      out.push(String.fromCharCode(read.value));
      i += 2 + read.consumed;
      continue;
    }

    // \uHHHH or \u{…}
    if (next === 'u') {
      if (preset.supportsUnicodeBraces && text[i + 2] === '{') {
        const read = readBracedHex(text, i + 3);
        if (read === null) {
          return {
            ok: false,
            kind: 'malformed-escape',
            position: i,
            reason: 'truncated-unicode-braces',
          };
        }
        out.push(String.fromCodePoint(read.value));
        i += 3 + read.consumed;
        continue;
      }
      const read = readHex(text, i + 2, 4);
      if (read === null) {
        return {
          ok: false,
          kind: 'malformed-escape',
          position: i,
          reason: 'expected-four-hex-digits',
        };
      }
      out.push(String.fromCharCode(read.value));
      i += 2 + read.consumed;
      continue;
    }

    // \UHHHHHHHH (Python only)
    if (next === 'U' && preset.supportsLongUnicode) {
      const read = readHex(text, i + 2, 8);
      if (read === null) {
        return {
          ok: false,
          kind: 'malformed-escape',
          position: i,
          reason: 'expected-eight-hex-digits',
        };
      }
      if (read.value > 0x10ffff) {
        return {
          ok: false,
          kind: 'malformed-escape',
          position: i,
          reason: 'expected-eight-hex-digits',
        };
      }
      out.push(String.fromCodePoint(read.value));
      i += 2 + read.consumed;
      continue;
    }

    // \ooo (Python octal) — 1 to 3 octal digits.
    if (preset.supportsOctal && isOctalDigit(next)) {
      const read = readOctal(text, i + 1);
      if (read === null) {
        return {
          ok: false,
          kind: 'malformed-escape',
          position: i,
          reason: 'expected-octal-digits',
        };
      }
      out.push(String.fromCharCode(read.value));
      i += 1 + read.consumed;
      continue;
    }

    return { ok: false, kind: 'malformed-escape', position: i, reason: 'unknown-escape' };
  }

  return { ok: true, output: out.join('') };
}
