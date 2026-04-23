import { describe, expect, it } from 'vitest';
import { escapeWithPreset, unescapeWithPreset } from '@/utils/backslashEscape';

describe('escapeWithPreset', () => {
  describe('javascript', () => {
    it('encodes the whole named-map set', () => {
      const result = escapeWithPreset('\0\b\f\n\r\t\v\\\'"', 'javascript');
      expect(result.output).toBe('\\0\\b\\f\\n\\r\\t\\v\\\\\\\'\\"');
    });

    it('passes printable ASCII through verbatim', () => {
      const result = escapeWithPreset('Hello, World!', 'javascript');
      expect(result.output).toBe('Hello, World!');
    });

    it('escapes control chars outside the named map as \\xHH', () => {
      const result = escapeWithPreset('\x01\x1f', 'javascript');
      expect(result.output).toBe('\\x01\\x1F');
    });

    it('escapes DEL + C1 controls as \\xHH', () => {
      const result = escapeWithPreset('\x7f\x85\x9f', 'javascript');
      expect(result.output).toBe('\\x7F\\x85\\x9F');
    });

    it('leaves non-ASCII printable characters alone', () => {
      const result = escapeWithPreset('café 日本 😀', 'javascript');
      expect(result.output).toBe('café 日本 😀');
    });
  });

  describe('json', () => {
    it('encodes the JSON-legal named set only (no \\v, no \\\')', () => {
      const result = escapeWithPreset('\b\f\n\r\t\\"', 'json');
      expect(result.output).toBe('\\b\\f\\n\\r\\t\\\\\\"');
    });

    it('treats \\v as a numeric control (not a named escape)', () => {
      const result = escapeWithPreset('\v', 'json');
      expect(result.output).toBe('\\u000B');
    });

    it('treats single quotes as literal (JSON does not escape them)', () => {
      const result = escapeWithPreset("it's", 'json');
      expect(result.output).toBe("it's");
    });

    it('escapes non-ASCII as \\uHHHH for valid JSON string content', () => {
      const result = escapeWithPreset('é', 'json');
      expect(result.output).toBe('\\u00E9');
    });

    it('emits surrogate pair for astral codepoints', () => {
      const result = escapeWithPreset('😀', 'json');
      expect(result.output).toBe('\\uD83D\\uDE00');
    });
  });

  describe('python', () => {
    it('encodes the Python named-map set including \\a (bell)', () => {
      const result = escapeWithPreset('\x07\n\t', 'python');
      expect(result.output).toBe('\\a\\n\\t');
    });

    it('escapes non-ASCII as hex bytes when code fits in \\xHH', () => {
      const result = escapeWithPreset('\x80', 'python');
      expect(result.output).toBe('\\x80');
    });
  });

  describe('sql-mysql', () => {
    it('encodes \\0, \\n, \\r, \\t, \\Z, backslash, and quotes', () => {
      const result = escapeWithPreset('\0\n\r\t\x1a\\\'"', 'sql-mysql');
      expect(result.output).toBe('\\0\\n\\r\\t\\Z\\\\\\\'\\"');
    });

    it('leaves LIKE wildcards % and _ alone', () => {
      const result = escapeWithPreset('100% _foo_', 'sql-mysql');
      expect(result.output).toBe('100% _foo_');
    });
  });

  describe('empty input', () => {
    it('returns empty output for empty input (every preset)', () => {
      for (const preset of ['javascript', 'json', 'python', 'sql-mysql'] as const) {
        const result = escapeWithPreset('', preset);
        expect(result.output).toBe('');
      }
    });
  });
});

describe('unescapeWithPreset', () => {
  describe('javascript', () => {
    it('decodes the whole named-map set', () => {
      const result = unescapeWithPreset('\\0\\b\\f\\n\\r\\t\\v\\\\\\\'\\"\\`', 'javascript');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('\0\b\f\n\r\t\v\\\'"`');
    });

    it('decodes \\xHH hex bytes', () => {
      const result = unescapeWithPreset('\\x41\\x42', 'javascript');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('AB');
    });

    it('decodes \\uHHHH', () => {
      const result = unescapeWithPreset('caf\\u00E9', 'javascript');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('café');
    });

    it('decodes \\u{…} for astral codepoints', () => {
      const result = unescapeWithPreset('\\u{1F600}', 'javascript');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('😀');
    });

    it('surfaces expected-two-hex-digits for short \\x', () => {
      const result = unescapeWithPreset('a\\x1', 'javascript');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('expected-two-hex-digits');
        expect(result.position).toBe(1);
      }
    });

    it('surfaces expected-four-hex-digits for short \\u', () => {
      const result = unescapeWithPreset('\\u12', 'javascript');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('expected-four-hex-digits');
    });

    it('surfaces truncated-unicode-braces when \\u{ has no closing brace', () => {
      const result = unescapeWithPreset('\\u{1F600', 'javascript');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('truncated-unicode-braces');
    });

    it('rejects unknown escapes instead of silently dropping the backslash', () => {
      const result = unescapeWithPreset('a\\q', 'javascript');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('unknown-escape');
        expect(result.position).toBe(1);
      }
    });

    it('surfaces trailing-backslash when the input ends with a lone \\', () => {
      const result = unescapeWithPreset('hello\\', 'javascript');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('trailing-backslash');
    });
  });

  describe('json', () => {
    it('does NOT accept \\xHH (JSON has no hex-byte escape)', () => {
      const result = unescapeWithPreset('\\x41', 'json');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unknown-escape');
    });

    it('does NOT accept \\u{…} (JSON has no brace unicode)', () => {
      // The JSON preset requires exactly four hex digits after \u — the
      // `{` at position 2 is not a hex digit, so the parse aborts with
      // `expected-four-hex-digits`. This pins the closed-enum behavior
      // so any future permissive relaxation is deliberate.
      const result = unescapeWithPreset('\\u{1F600}', 'json');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('expected-four-hex-digits');
        expect(result.position).toBe(0);
      }
    });

    it('decodes \\uHHHH surrogate pair to an astral codepoint', () => {
      const result = unescapeWithPreset('\\uD83D\\uDE00', 'json');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('😀');
    });
  });

  describe('python', () => {
    it('decodes octal escapes \\NNN', () => {
      const result = unescapeWithPreset('\\101\\102', 'python');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('AB');
    });

    it('octal stops after 3 digits', () => {
      const result = unescapeWithPreset('\\1011', 'python');
      expect(result.ok).toBe(true);
      // \101 → 'A', then literal '1'.
      if (result.ok) expect(result.output).toBe('A1');
    });

    it('decodes \\UHHHHHHHH for astral codepoints', () => {
      const result = unescapeWithPreset('\\U0001F600', 'python');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('😀');
    });

    it('surfaces expected-eight-hex-digits for short \\U', () => {
      const result = unescapeWithPreset('\\U0001F60', 'python');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('expected-eight-hex-digits');
    });

    it('decodes \\a as 0x07 (bell)', () => {
      const result = unescapeWithPreset('\\a', 'python');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('\x07');
    });
  });

  describe('sql-mysql', () => {
    it('decodes \\0, \\n, \\r, \\t, \\Z, quotes, and backslash', () => {
      const result = unescapeWithPreset('\\0\\n\\r\\t\\Z\\\\\\\'\\"', 'sql-mysql');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('\0\n\r\t\x1a\\\'"');
    });

    it('does NOT accept \\xHH (MySQL backslash escapes have no \\x)', () => {
      const result = unescapeWithPreset('\\x41', 'sql-mysql');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unknown-escape');
    });
  });

  describe('empty + passthrough', () => {
    it('returns empty output for empty input (every preset)', () => {
      for (const preset of ['javascript', 'json', 'python', 'sql-mysql'] as const) {
        const result = unescapeWithPreset('', preset);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.output).toBe('');
      }
    });

    it('passes non-escape chars through unchanged', () => {
      const result = unescapeWithPreset('Hello, World!', 'javascript');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.output).toBe('Hello, World!');
    });
  });
});

describe('round-trip', () => {
  const SAMPLES = [
    'Hello, "World"\n',
    "it's a tab\there",
    'caf\u00e9 emoji 😀',
    '\0\b\f\n\r\t',
    'path\\to\\file',
  ];

  it('escape then unescape is identity for JavaScript', () => {
    for (const sample of SAMPLES) {
      const escaped = escapeWithPreset(sample, 'javascript');
      const back = unescapeWithPreset(escaped.output, 'javascript');
      expect(back.ok).toBe(true);
      if (back.ok) expect(back.output).toBe(sample);
    }
  });

  it('escape then unescape is identity for JSON', () => {
    // JSON samples exclude single quotes + \v (not in the JSON named map).
    const jsonSamples = [
      'Hello, "World"\n',
      'caf\u00e9 emoji 😀',
      '\b\f\n\r\t',
      'path\\to\\file',
    ];
    for (const sample of jsonSamples) {
      const escaped = escapeWithPreset(sample, 'json');
      const back = unescapeWithPreset(escaped.output, 'json');
      expect(back.ok).toBe(true);
      if (back.ok) expect(back.output).toBe(sample);
    }
  });

  it('escape then unescape is identity for Python', () => {
    for (const sample of SAMPLES) {
      const escaped = escapeWithPreset(sample, 'python');
      const back = unescapeWithPreset(escaped.output, 'python');
      expect(back.ok).toBe(true);
      if (back.ok) expect(back.output).toBe(sample);
    }
  });

  it('escape then unescape is identity for SQL-MySQL', () => {
    const sqlSamples = [
      'Hello, "World"\n',
      "it's a tab\there",
      '\0\n\r\t',
      'path\\to\\file',
      '100% _foo_',
    ];
    for (const sample of sqlSamples) {
      const escaped = escapeWithPreset(sample, 'sql-mysql');
      const back = unescapeWithPreset(escaped.output, 'sql-mysql');
      expect(back.ok).toBe(true);
      if (back.ok) expect(back.output).toBe(sample);
    }
  });
});
