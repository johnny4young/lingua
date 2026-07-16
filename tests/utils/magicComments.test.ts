import { describe, it, expect } from 'vitest';
import {
  detectJSMagicComments,
  transformJSMagicComments,
  detectPythonMagicComments,
  transformPythonMagicComments,
  magicCommentKindsByLine,
  detectJSAutoLogLines,
  transformJSAutoLog,
  originSuppressedByMagicComment,
  gitStatusSuppressedByMagicComment,
  gitWatchHeadSuppressedByMagicComment,
  detectJSStatementStartLines,
  lineTimingRequestedByMagicComment,
  transformJSLineTiming,
} from '@/utils/magicComments';

describe('JS/TS magic comments', () => {
  describe('detectJSMagicComments', () => {
    it('detects //=> at end of line', () => {
      const code = 'const x = 1;\nx; //=> should be 1';
      const results = detectJSMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        line: 2,
        expression: 'x;',
        kind: 'arrow',
      });
    });

    it('detects //=> with spaces before arrow', () => {
      const code = 'Math.PI; // => pi value';
      const results = detectJSMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        line: 1,
        expression: 'Math.PI;',
        kind: 'arrow',
      });
    });

    it('returns empty array for code without magic comments', () => {
      const code = 'const x = 1;\nconsole.log(x);';
      expect(detectJSMagicComments(code)).toHaveLength(0);
    });

    it('handles multiple magic comments', () => {
      const code = 'const a = 1; //=>\nconst b = 2;\nb; //=>';
      const results = detectJSMagicComments(code);
      expect(results).toHaveLength(2);
      expect(results[0]!.line).toBe(1);
      expect(results[1]!.line).toBe(3);
    });

    it('ignores empty expressions', () => {
      const code = '//=> just a comment';
      expect(detectJSMagicComments(code)).toHaveLength(0);
    });
  });

  describe('transformJSMagicComments', () => {
    it('wraps expression in __mc call', () => {
      const code = 'const x = 1;\nx; //=> should be 1';
      const transformed = transformJSMagicComments(code);
      expect(transformed).toContain('__mc(2,');
      expect(transformed).toContain('const x = 1;');
    });

    it('preserves non-magic lines', () => {
      const code = 'const x = 1;\nconsole.log(x);';
      expect(transformJSMagicComments(code)).toBe(code);
    });

    it('strips trailing semicolons from expressions', () => {
      const code = 'x; //=>';
      const transformed = transformJSMagicComments(code);
      // The expression should be `x` not `x;`
      expect(transformed).toContain('return (x)');
    });

    it('handles complex expressions', () => {
      const code = '[1, 2, 3].map(x => x * 2); //=>';
      const transformed = transformJSMagicComments(code);
      expect(transformed).toContain('__mc(1,');
      expect(transformed).toContain('[1, 2, 3].map(x => x * 2)');
    });
  });

  describe('RL-020 Slice 3 — @watch JS/TS detection', () => {
    it('detects `// @watch <expr>` with the watch kind + empty preserve when alone', () => {
      const code = '// @watch counter';
      // The line is comment-only with no prefix code, so `preserve` is empty.
      const results = detectJSMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        line: 1,
        expression: 'counter',
        kind: 'watch',
        preserve: '',
      });
    });

    it('detects watch with prefix code that must be preserved', () => {
      const code = 'const x = 5; // @watch x * 2';
      const results = detectJSMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        line: 1,
        expression: 'x * 2',
        kind: 'watch',
        preserve: 'const x = 5;',
      });
    });

    it('watch wins over arrow when both shapes appear on the line', () => {
      // `// @watch x //=> y` — watch matches first; arrow is shadowed.
      const code = '// @watch x //=> y';
      const results = detectJSMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]!.kind).toBe('watch');
      expect(results[0]!.expression).toBe('x //=> y');
    });

    it('treats empty `// @watch` (no expression) as a regular comment', () => {
      const code = '// @watch';
      expect(detectJSMagicComments(code)).toHaveLength(0);
    });
  });

  describe('RL-020 Slice 3 — @watch JS/TS transform', () => {
    it('preserves the prefix and appends __mc for the watched expression', () => {
      const code = 'const x = 5; // @watch x * 2';
      const transformed = transformJSMagicComments(code);
      expect(transformed).toContain('const x = 5;');
      expect(transformed).toContain('__mc(1,');
      expect(transformed).toContain('return (x * 2)');
    });

    it('handles a comment-only watch line with no prefix to preserve', () => {
      const code = 'const x = 5;\n// @watch x';
      const transformed = transformJSMagicComments(code);
      // Line 1 unchanged; line 2 emits the __mc call only.
      expect(transformed.split('\n')[0]).toBe('const x = 5;');
      expect(transformed).toContain('__mc(2,');
    });

    it('preserves the prefix without doubling the separator after `}`', () => {
      const code = 'if (true) { x } // @watch x';
      const transformed = transformJSMagicComments(code);
      // The if-body closes with `}` so no extra `;` should be injected.
      expect(transformed).toContain('if (true) { x }');
      expect(transformed).not.toContain('}; ;');
    });
  });

  describe('magicCommentKindsByLine — JS', () => {
    it('returns a sparse Record keyed by line number with the kind', () => {
      const code = [
        'const a = 1; //=>',
        'const b = 2;',
        'const c = 3; // @watch c',
      ].join('\n');
      const map = magicCommentKindsByLine('javascript', code);
      expect(map).toEqual({ 1: 'arrow', 3: 'watch' });
    });
    it('returns the same shape under typescript', () => {
      const map = magicCommentKindsByLine('typescript', 'x //=> peek');
      expect(map).toEqual({ 1: 'arrow' });
    });
    it('merges autoLog kinds when options.autoLog is true', () => {
      const code = ['const a = 1;', 'a + 2', 'a //=>'].join('\n');
      const map = magicCommentKindsByLine('javascript', code, { autoLog: true });
      // Line 1 is a declaration, skipped. Line 2 is a bare
      // expression, auto-logged. Line 3 is an arrow that wins over
      // auto-log via the magic-line skip set.
      expect(map).toEqual({ 2: 'autoLog', 3: 'arrow' });
    });
    it('leaves Python untouched even when autoLog is true', () => {
      const code = 'x = 1\nx';
      const map = magicCommentKindsByLine('python', code, { autoLog: true });
      expect(map).toEqual({});
    });
  });

  describe('RL-020 Slice 5 — JS/TS auto-log detector', () => {
    it('flags a bare identifier expression', () => {
      expect(detectJSAutoLogLines('x')).toEqual([1]);
    });
    it('flags an arithmetic expression', () => {
      expect(detectJSAutoLogLines('1 + 1')).toEqual([1]);
    });
    it('flags a method call expression', () => {
      expect(detectJSAutoLogLines('[1,2,3].length')).toEqual([1]);
    });
    it('flags optional-chain expressions', () => {
      expect(detectJSAutoLogLines('foo?.bar')).toEqual([1]);
    });
    it('flags `await fetch(...)` at top level', () => {
      // `await` is operator-prefixed; the leading keyword is not in
      // the skip set so the expression auto-logs.
      expect(detectJSAutoLogLines('await fetch("/")')).toEqual([1]);
    });
    it('flags `new Date()` at top level', () => {
      expect(detectJSAutoLogLines('new Date()')).toEqual([1]);
    });
    it('skips declarations', () => {
      expect(detectJSAutoLogLines('const x = 5;')).toEqual([]);
      expect(detectJSAutoLogLines('let y = 6;')).toEqual([]);
      expect(detectJSAutoLogLines('var z = 7;')).toEqual([]);
    });
    it('skips control-flow statements', () => {
      expect(detectJSAutoLogLines('if (x) { y }')).toEqual([]);
      expect(detectJSAutoLogLines('for (const i of xs) {}')).toEqual([]);
      expect(detectJSAutoLogLines('while (x) { y }')).toEqual([]);
      expect(detectJSAutoLogLines('return 1;')).toEqual([]);
    });
    it('skips single-line async function + async class declarations', () => {
      expect(
        detectJSAutoLogLines('async function f() { return 1; }')
      ).toEqual([]);
      expect(detectJSAutoLogLines('async class Foo {}')).toEqual([]);
    });
    it('skips multi-line expressions (line ending with `,`)', () => {
      const code = 'const a = {\n  x: 1,\n};';
      // None of the three lines is a bare top-level expression: line
      // 1 is a declaration, line 2 ends with a continuation `,`,
      // line 3 closes the object literal.
      expect(detectJSAutoLogLines(code)).toEqual([]);
    });
    it('skips lines inside a function body', () => {
      const code = 'function f() {\n  x\n}';
      expect(detectJSAutoLogLines(code)).toEqual([]);
    });
    it('skips empty + whitespace-only + comment-only lines', () => {
      const code = '\n   \n// just a comment\n/* block */';
      expect(detectJSAutoLogLines(code)).toEqual([]);
    });
    it('skips lines already claimed by a magic comment when the skip set is supplied', () => {
      const code = ['x //=>', 'y', 'z // @watch z'].join('\n');
      // Caller passes the magic-comment lines (1 and 3) so the
      // detector only yields line 2.
      const detected = detectJSAutoLogLines(code, new Set([1, 3]));
      expect(detected).toEqual([2]);
    });
    it('skips JSX-opening lines conservatively', () => {
      const code = '<Foo />';
      expect(detectJSAutoLogLines(code)).toEqual([]);
    });
    it('combines positive + negative cases in a single buffer', () => {
      const code = [
        'const a = 1;',
        'a + 2',
        'function f() { return 1; }',
        '[1,2,3].length',
        '// trailing comment',
      ].join('\n');
      expect(detectJSAutoLogLines(code)).toEqual([2, 4]);
    });

    it('keeps scanning after regex literals inside formatted helpers', () => {
      const code = [
        "const REDACTED_LOG_VALUE = '[REDACTED]';",
        'function sanitizeLogString(value: string): string {',
        '  return value',
        '    .replace(',
        '      /([a-z]+:\\/\\/)([^:/\\s@]+):([^@\\s]+)@/gi,',
        '      `$1${REDACTED_LOG_VALUE}:${REDACTED_LOG_VALUE}@`,',
        '    )',
        '    .replace(',
        '      /("authorization"\\s*:\\s*")Bearer\\s+[^"]+(")/gi,',
        '      `$1Bearer ${REDACTED_LOG_VALUE}$2`,',
        '    );',
        '}',
        'const error1 = new Error("Test error from Lingua");',
        'console.log(sanitizeLogString("eee1"));',
        '"abc";',
      ].join('\n');

      expect(detectJSAutoLogLines(code)).toEqual([14, 15]);
    });

    it('keeps all trailing scratchpad probes in a long sanitizer helper', () => {
      const lines = [
        "const REDACTED_LOG_VALUE = '[REDACTED]';",
        'const SENSITIVE_LOG_KEY_PATTERNS = [',
        "  'authorization',",
        "  'token',",
        "  'secret',",
        "  'password',",
        "  'api-key',",
        "  'apikey',",
        "  'client-secret',",
        '];',
        '',
        'function shouldRedactLogKey(key: string): boolean {',
        "  const normalizedKey = key.toLowerCase().replace(/[_\\s]/g, '-');",
        '  return SENSITIVE_LOG_KEY_PATTERNS.some(pattern =>',
        '    normalizedKey.includes(pattern),',
        '  );',
        '}',
        '',
        'function sanitizeLogString(value: string): string {',
        '  return value',
        '    .replace(',
        '      /([a-z]+:\\/\\/)([^:/\\s@]+):([^@\\s]+)@/gi,',
        '      `$1${REDACTED_LOG_VALUE}:${REDACTED_LOG_VALUE}@`,',
        '    )',
        '    .replace(',
        '      /("authorization"\\s*:\\s*")Bearer\\s+[^"]+(")/gi,',
        '      `$1Bearer ${REDACTED_LOG_VALUE}$2`,',
        '    )',
        '    .replace(',
        '      /(\\\\"authorization\\\\"\\s*:\\s*\\\\")Bearer\\s+[^\\\\"]+(\\\\")/gi,',
        '      `$1Bearer ${REDACTED_LOG_VALUE}$2`,',
        '    );',
        '}',
        '',
        'function tryParseJsonLikeLogString(value: string): unknown {',
        '  const attempts = [value, value.replace(/\\\\"/g, \'"\')];',
        '',
        '  for (const attempt of attempts) {',
        '    const trimmedAttempt = attempt.trim();',
        '    if (',
        '      !(',
        "        trimmedAttempt.startsWith('{') ||",
        "        trimmedAttempt.startsWith('[') ||",
        '        (trimmedAttempt.startsWith(\'"\') &&',
        '          (trimmedAttempt.includes(\'\\\\"{\') || trimmedAttempt.includes(\'\\\\"[\')))',
        '      )',
        '    ) {',
        '      continue;',
        '    }',
        '',
        '    try {',
        '      const parsed = JSON.parse(trimmedAttempt);',
        "      if (typeof parsed === 'string') {",
        '        const nested = parsed.trim();',
        "        if (nested.startsWith('{') || nested.startsWith('[')) {",
        '          return JSON.parse(nested);',
        '        }',
        '      }',
        '      return parsed;',
        '    } catch {',
        '      continue;',
        '    }',
        '  }',
        '',
        '  return undefined;',
        '}',
        '',
        'function sanitizeLogValue(',
        '  value: unknown,',
        '  parentKey?: string,',
        '  seen: WeakSet<object> = new WeakSet(),',
        '): unknown {',
        '  if (value === null || value === undefined) {',
        '    return value;',
        '  }',
        '',
        '  if (',
        "    typeof value === 'string' ||",
        "    typeof value === 'number' ||",
        "    typeof value === 'boolean'",
        '  ) {',
        "    if (typeof value === 'string') {",
        '      const parsedValue = tryParseJsonLikeLogString(value);',
        '      return parsedValue === undefined',
        '        ? sanitizeLogString(value)',
        '        : sanitizeLogValue(parsedValue, parentKey, seen);',
        '    }',
        '    return value;',
        '  }',
        '',
        "  if (typeof value === 'function') {",
        "    return `[Function ${value.name || 'anonymous'}]`;",
        '  }',
        '',
        '  if (value instanceof Error) {',
        '    return sanitizeLogValue(',
        '      {',
        '        name: value.name,',
        '        message: value.message,',
        '        stack: value.stack,',
        '        ...value,',
        '      },',
        '      parentKey,',
        '      seen,',
        '    );',
        '  }',
        '',
        '  if (Array.isArray(value)) {',
        '    return value.map(item => sanitizeLogValue(item, parentKey, seen));',
        '  }',
        '',
        "  if (typeof value === 'object') {",
        '    if (seen.has(value)) {',
        "      return '[Circular]';",
        '    }',
        '',
        '    seen.add(value);',
        '    const sanitizedObject = {};',
        '    for (const [key, nestedValue] of Object.entries(value)) {',
        "      if (parentKey === 'auth' || shouldRedactLogKey(key)) {",
        '        sanitizedObject[`${key}`] = REDACTED_LOG_VALUE;',
        '        continue;',
        '      }',
        '',
        '      sanitizedObject[`${key}`] = sanitizeLogValue(nestedValue, key, seen);',
        '    }',
        '    seen.delete(value);',
        '    return sanitizedObject;',
        '  }',
        '',
        '  return String(value);',
        '}',
        '',
        'const text = "hix2"',
        'text',
        'const error1 = new Error("Test error from Lingua")',
        'error1',
        'console.log(sanitizeLogString("eee3"))',
        'error1',
        '"hi"',
      ];
      const code = lines.join('\n');
      const line = (value: string) => lines.indexOf(value) + 1;

      expect(detectJSAutoLogLines(code)).toEqual([
        line('text'),
        line('error1'),
        line('console.log(sanitizeLogString("eee3"))'),
        lines.lastIndexOf('error1') + 1,
        line('"hi"'),
      ]);
    });
  });

  describe('RL-020 Slice 5 — JS/TS auto-log transform', () => {
    it('replaces a bare expression line with a single `__mc(line, ...)` capture', () => {
      const out = transformJSAutoLog('x + 1', [1]);
      expect(out).toContain('__mc(1,');
      expect(out).toContain('return (x + 1)');
      expect(out).not.toContain('x + 1; void');
    });
    it('preserves untargeted lines byte-for-byte', () => {
      const code = ['const a = 1;', 'a + 2'].join('\n');
      const out = transformJSAutoLog(code, [2]);
      expect(out.split('\n')[0]).toBe('const a = 1;');
      expect(out.split('\n')[1]).toContain('__mc(2,');
    });
    it('is a no-op when the line list is empty', () => {
      const code = 'a + 2';
      expect(transformJSAutoLog(code, [])).toBe(code);
    });
    it('preserves a trailing line comment outside the captured expression', () => {
      const out = transformJSAutoLog('x + 1 // keep this note', [1]);
      expect(out).toContain('return (x + 1)');
      expect(out).toContain('// keep this note');
      expect(out).not.toContain('return (x + 1 // keep this note)');
    });
    it('does not treat // inside strings as a trailing comment', () => {
      const out = transformJSAutoLog('"https://linguacode.dev"', [1]);
      expect(out).toContain('return ("https://linguacode.dev")');
    });
    it('executes side-effecting expressions only once', async () => {
      const out = transformJSAutoLog('let calls = 0;\n++calls', [2]);
      const captured: Array<{ line: number; value: unknown }> = [];
      const AsyncFunction = Object.getPrototypeOf(
        async function () {}
      ).constructor as new (
        ...args: string[]
      ) => (__mc: (line: number, value: unknown) => void) => Promise<number>;
      const fn = new AsyncFunction('__mc', `${out}\nreturn calls;`);
      const calls = await fn((line, value) => captured.push({ line, value }));
      expect(calls).toBe(1);
      expect(captured).toEqual([{ line: 2, value: 1 }]);
    });
    it('wraps top-level await without breaking the parent block boundary', async () => {
      const out = transformJSAutoLog('await Promise.resolve(1)', [1]);
      expect(out).toContain('return (await Promise.resolve(1))');
      const captured: Array<{ line: number; value: unknown }> = [];
      const AsyncFunction = Object.getPrototypeOf(
        async function () {}
      ).constructor as new (
        ...args: string[]
      ) => (__mc: (line: number, value: unknown) => void) => Promise<void>;
      const fn = new AsyncFunction('__mc', out);
      await fn((line, value) => captured.push({ line, value }));
      expect(captured).toEqual([{ line: 1, value: 1 }]);
    });
  });
});

describe('Python magic comments', () => {
  describe('detectPythonMagicComments', () => {
    it('detects #=> at end of line', () => {
      const code = 'x = 1\nx #=> should be 1';
      const results = detectPythonMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        line: 2,
        expression: 'x',
        kind: 'arrow',
      });
    });

    it('detects # => with spaces', () => {
      const code = 'len([1,2,3]) # => length';
      const results = detectPythonMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]!.expression).toBe('len([1,2,3])');
      expect(results[0]!.kind).toBe('arrow');
    });

    it('returns empty for code without magic comments', () => {
      const code = 'x = 1\nprint(x)';
      expect(detectPythonMagicComments(code)).toHaveLength(0);
    });
  });

  describe('transformPythonMagicComments', () => {
    it('wraps expression in __mc call with lambda', () => {
      const code = 'x = 1\nx #=>';
      const transformed = transformPythonMagicComments(code);
      expect(transformed).toContain('__mc(2, lambda: (x))');
      expect(transformed).toContain('x = 1');
    });

    it('preserves non-magic lines', () => {
      const code = 'x = 1\nprint(x)';
      expect(transformPythonMagicComments(code)).toBe(code);
    });

    it('preserves indentation for arrows inside function bodies', () => {
      const code = 'def fn():\n    x = 1\n    x #=>';
      const transformed = transformPythonMagicComments(code);
      expect(transformed.split('\n')[2]).toBe('    __mc(3, lambda: (x))');
    });
  });

  describe('RL-020 Slice 3 — @watch Python detection + transform', () => {
    it('detects `# @watch <expr>` with watch kind', () => {
      const code = 'counter = 5  # @watch counter * 2';
      const results = detectPythonMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        line: 1,
        expression: 'counter * 2',
        kind: 'watch',
        preserve: 'counter = 5',
      });
    });

    it('preserves the prefix and appends __mc for the watched expression', () => {
      const code = 'counter = 5  # @watch counter * 2';
      const transformed = transformPythonMagicComments(code);
      // Both the assignment and the watch call must appear on the same
      // logical line, separated by `;` so Python keeps the declaration.
      expect(transformed).toContain('counter = 5');
      expect(transformed).toContain('__mc(1, lambda: (counter * 2))');
    });

    it('handles a comment-only watch line with no prefix', () => {
      const code = 'x = 1\n# @watch x';
      const transformed = transformPythonMagicComments(code);
      expect(transformed.split('\n')[1]).toBe('__mc(2, lambda: (x))');
    });

    it('preserves indentation for comment-only watches inside function bodies', () => {
      const code = 'def fn():\n    x = 1\n    # @watch x';
      const transformed = transformPythonMagicComments(code);
      expect(transformed.split('\n')[2]).toBe('    __mc(3, lambda: (x))');
    });

    it('REFUSES watches on control-flow header lines (preserves body)', () => {
      // `if x > 0:  # @watch x` — appending the watch on the same
      // line would eat the indented body. The detector must skip
      // this so the transform leaves the line unchanged.
      const code = 'if x > 0:  # @watch x\n    print(x)';
      expect(detectPythonMagicComments(code)).toHaveLength(0);
      expect(transformPythonMagicComments(code)).toBe(code);
    });

    it('preserves indentation for watches inside a function body', () => {
      const code = 'def fn():\n    x = 1  # @watch x';
      const transformed = transformPythonMagicComments(code);
      // The transformed line should start with the same 4-space indent.
      expect(transformed.split('\n')[1]).toMatch(/^ {4}x = 1; __mc/);
    });
  });

  describe('magicCommentKindsByLine — Python', () => {
    it('returns the per-line kind map', () => {
      const code = ['x = 1  #=>', 'y = 2', 'z = 3  # @watch z'].join('\n');
      const map = magicCommentKindsByLine('python', code);
      expect(map).toEqual({ 1: 'arrow', 3: 'watch' });
    });
  });
});

describe('RL-044 Slice 1A — //=> table directive', () => {
  describe('JS arrow directive', () => {
    it('parses the table directive on an arrow comment', () => {
      const code = '[{a:1}] //=> table';
      const [entry] = detectJSMagicComments(code);
      expect(entry).toBeDefined();
      expect(entry?.kind).toBe('arrow');
      expect(entry?.directive).toBe('table');
    });

    it('is case-insensitive', () => {
      const code = '[1,2] //=> TABLE';
      const [entry] = detectJSMagicComments(code);
      expect(entry?.directive).toBe('table');
    });

    it('omits the directive field when no directive is present', () => {
      const code = '[1,2] //=>';
      const [entry] = detectJSMagicComments(code);
      expect(entry).toBeDefined();
      expect(entry?.directive).toBeUndefined();
    });

    it('recognises chart / image / html directives (RL-044 Slice 2b-α)', () => {
      // Slice 2b-α widens the parser's closed enum ahead of Slice
      // 2b-β runner consumption. A typo (e.g. `chartt`) still falls
      // through to legacy.
      const chart = detectJSMagicComments('[1,2] //=> chart')[0];
      expect(chart?.kind).toBe('arrow');
      expect(chart?.directive).toBe('chart');
      const image = detectJSMagicComments('"data:image/png;base64,a" //=> image')[0];
      expect(image?.directive).toBe('image');
      const html = detectJSMagicComments('"<p>x</p>" //=> html')[0];
      expect(html?.directive).toBe('html');
    });

    it('ignores typo / unknown directive words gracefully', () => {
      // Anything outside the closed enum still falls through to the
      // legacy arrow path (no directive attached).
      const code = '[1,2] //=> notakind';
      const [entry] = detectJSMagicComments(code);
      expect(entry?.kind).toBe('arrow');
      expect(entry?.directive).toBeUndefined();
    });

    it('still works when the directive has trailing whitespace', () => {
      const code = '[1] //=> table   ';
      const [entry] = detectJSMagicComments(code);
      expect(entry?.directive).toBe('table');
    });

    it('resolves the figure alias to the chart directive (RL-044 Slice 2b-β-β-α fold G)', () => {
      // matplotlib convention: users say `figure`, runner sees `chart`.
      const [entry] = detectJSMagicComments('spec //=> figure');
      expect(entry?.kind).toBe('arrow');
      expect(entry?.directive).toBe('chart');
    });
  });

  describe('Python arrow directive', () => {
    it('parses the table directive on a Python arrow comment', () => {
      const code = '[{"a":1}]  #=> table';
      const [entry] = detectPythonMagicComments(code);
      expect(entry?.kind).toBe('arrow');
      expect(entry?.directive).toBe('table');
    });

    it('omits the directive field when no directive is present', () => {
      const code = '[1]  #=>';
      const [entry] = detectPythonMagicComments(code);
      expect(entry?.directive).toBeUndefined();
    });

    it('resolves the figure alias on Python too (RL-044 Slice 2b-β-β-α fold G)', () => {
      const code = 'spec  #=> figure';
      const [entry] = detectPythonMagicComments(code);
      expect(entry?.directive).toBe('chart');
    });
  });
});

describe('originSuppressedByMagicComment — RL-044 Sub-slice G Fold F', () => {
  it('detects `// @origin off` in a JS buffer', () => {
    expect(originSuppressedByMagicComment('javascript', '// @origin off\nconsole.log("x")')).toBe(true);
    expect(originSuppressedByMagicComment('typescript', '// @origin off')).toBe(true);
  });

  it('detects `# @origin off` in a Python buffer', () => {
    expect(originSuppressedByMagicComment('python', '# @origin off\nprint("x")')).toBe(true);
  });

  it('tolerates an optional colon and case-insensitive `off`', () => {
    expect(originSuppressedByMagicComment('javascript', '// @origin: off')).toBe(true);
    expect(originSuppressedByMagicComment('javascript', '// @origin OFF')).toBe(true);
    expect(originSuppressedByMagicComment('python', '# @origin Off')).toBe(true);
  });

  it('returns false when no directive is present', () => {
    expect(originSuppressedByMagicComment('javascript', 'console.log("x")')).toBe(false);
    expect(originSuppressedByMagicComment('python', '# @origin on')).toBe(false);
    expect(originSuppressedByMagicComment('python', '# origin off')).toBe(false);
  });

  it('skips unsupported languages — Go / Rust / etc. cannot toggle origin via this directive', () => {
    expect(originSuppressedByMagicComment('go', '// @origin off')).toBe(false);
    expect(originSuppressedByMagicComment('rust', '// @origin off')).toBe(false);
    expect(originSuppressedByMagicComment('ruby', '# @origin off')).toBe(false);
  });

  it('handles empty / non-string input safely', () => {
    expect(originSuppressedByMagicComment('javascript', '')).toBe(false);
    expect(originSuppressedByMagicComment('python', '')).toBe(false);
  });
});

describe('gitStatusSuppressedByMagicComment — RL-102 Slice 1 Fold F', () => {
  it('detects `// @git-ignore-status` in a JS / TS buffer', () => {
    expect(
      gitStatusSuppressedByMagicComment('javascript', '// @git-ignore-status')
    ).toBe(true);
    expect(
      gitStatusSuppressedByMagicComment('typescript', '// @git-ignore-status\nfoo;')
    ).toBe(true);
  });

  it('detects `# @git-ignore-status` in Python / Ruby buffers', () => {
    expect(
      gitStatusSuppressedByMagicComment('python', '# @git-ignore-status')
    ).toBe(true);
    expect(
      gitStatusSuppressedByMagicComment('ruby', '# @git-ignore-status')
    ).toBe(true);
  });

  it('is permissive about ANY language (unlike origin-off which is opt-in)', () => {
    // The Git layer is desktop-wide so the directive applies to any
    // source surface that supports `//` or `#` comments.
    expect(
      gitStatusSuppressedByMagicComment('go', '// @git-ignore-status')
    ).toBe(true);
    expect(
      gitStatusSuppressedByMagicComment('rust', '// @git-ignore-status')
    ).toBe(true);
  });

  it('accepts the loose-colon shape and is case-insensitive', () => {
    expect(
      gitStatusSuppressedByMagicComment('javascript', '// @git-ignore-status')
    ).toBe(true);
    expect(
      gitStatusSuppressedByMagicComment('javascript', '// @Git-Ignore-Status')
    ).toBe(true);
  });

  it('does not match a similar but distinct directive', () => {
    expect(
      gitStatusSuppressedByMagicComment('javascript', '// @git-status off')
    ).toBe(false);
    expect(
      gitStatusSuppressedByMagicComment('javascript', '// git-ignore-status')
    ).toBe(false);
  });

  it('handles empty / non-string input safely', () => {
    expect(gitStatusSuppressedByMagicComment('javascript', '')).toBe(false);
    expect(gitStatusSuppressedByMagicComment('', '// @git-ignore-status')).toBe(
      false
    );
  });

  it('uses an independent regex from `originSuppressedByMagicComment`', () => {
    // Coupled-invariant pin: a file with `// @origin off` should NOT
    // also suppress the git status (and vice versa). The two
    // directives evolve independently.
    expect(
      gitStatusSuppressedByMagicComment('javascript', '// @origin off')
    ).toBe(false);
    expect(
      originSuppressedByMagicComment('javascript', '// @git-ignore-status')
    ).toBe(false);
  });
});

describe('gitWatchHeadSuppressedByMagicComment (RL-102 Slice 2 Fold F)', () => {
  it('matches the `// @git-watch-head off` JS / TS directive', () => {
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'javascript',
        '// @git-watch-head off\nconst x = 1;'
      )
    ).toBe(true);
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'typescript',
        '// @git-watch-head off'
      )
    ).toBe(true);
  });

  it('matches the `# @git-watch-head off` Python / Ruby directive', () => {
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'python',
        '# @git-watch-head off\nprint("hi")'
      )
    ).toBe(true);
    expect(
      gitWatchHeadSuppressedByMagicComment('ruby', '# @git-watch-head off')
    ).toBe(true);
  });

  it('accepts the optional colon form (`// @git-watch-head: off`)', () => {
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'javascript',
        '// @git-watch-head: off'
      )
    ).toBe(true);
  });

  it('is case-insensitive on the directive name', () => {
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'javascript',
        '// @Git-Watch-Head off'
      )
    ).toBe(true);
  });

  it('rejects directive without the explicit `off` literal', () => {
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'javascript',
        '// @git-watch-head'
      )
    ).toBe(false);
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'javascript',
        '// @git-watch-head on'
      )
    ).toBe(false);
  });

  it('handles empty / non-string input safely', () => {
    expect(gitWatchHeadSuppressedByMagicComment('javascript', '')).toBe(false);
    expect(gitWatchHeadSuppressedByMagicComment('', '// @git-watch-head off')).toBe(
      false
    );
  });

  it('uses an independent regex from the other two pragmas (coupled invariant)', () => {
    // Three independent directives evolve separately:
    //   - `@origin off`            — privacy chip on console output
    //   - `@git-ignore-status`     — mute per-file git pill
    //   - `@git-watch-head off`    — mute HEAD watcher refresh
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'javascript',
        '// @origin off'
      )
    ).toBe(false);
    expect(
      gitWatchHeadSuppressedByMagicComment(
        'javascript',
        '// @git-ignore-status'
      )
    ).toBe(false);
    expect(
      originSuppressedByMagicComment(
        'javascript',
        '// @git-watch-head off'
      )
    ).toBe(false);
    expect(
      gitStatusSuppressedByMagicComment(
        'javascript',
        '// @git-watch-head off'
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RL-115 Slice 1 — per-line timing
// ---------------------------------------------------------------------------

describe('lineTimingRequestedByMagicComment (RL-115)', () => {
  it('detects real // @time comments anywhere in a JS/TS buffer', () => {
    expect(lineTimingRequestedByMagicComment('javascript', '// @time\nconst x = 1;')).toBe(true);
    expect(lineTimingRequestedByMagicComment('typescript', 'const x = 1;\n// @TIME')).toBe(true);
    expect(lineTimingRequestedByMagicComment('javascript', 'const x = 1; // @time')).toBe(true);
  });

  it('never matches lookalikes inside strings/regexes, @timeout, or other languages', () => {
    expect(lineTimingRequestedByMagicComment('javascript', '// @timeout 60s')).toBe(false);
    expect(lineTimingRequestedByMagicComment('python', '# @time')).toBe(false);
    expect(lineTimingRequestedByMagicComment('javascript', 'const time = 1;')).toBe(false);
    expect(lineTimingRequestedByMagicComment('javascript', 'const text = "// @time";')).toBe(false);
    expect(lineTimingRequestedByMagicComment('javascript', 'const pattern = /\\/\\/ @time/u;')).toBe(false);
  });
});

describe('detectJSStatementStartLines (RL-115)', () => {
  it('marks each top-level statement start, spanning multi-line statements', () => {
    const code = [
      'const a = 1;', // 1 ✓
      'const b = [', // 2 ✓ (statement spans 2-4)
      '  1, 2,', // 3 — inside brackets
      '];', // 4 — starts with ]
      'for (let i = 0; i < 3; i++) {', // 5 ✓
      '  work(i);', // 6 — inside braces
      '}', // 7 — starts with }
      'console.log(a);', // 8 ✓
    ].join('\n');
    expect(detectJSStatementStartLines(code)).toEqual([1, 2, 5, 8]);
  });

  it('never marks continuation lines, compound tails, or open-token interiors', () => {
    const code = [
      'const text = `', // 1 ✓
      'const fake = 1;', // 2 — inside template
      '`;', // 3 — starts inside template
      'if (a) {', // 4 ✓
      '}', // 5
      'else {', // 6 — blocked keyword
      '}', // 7
      'value', // 8 ✓ (statement 8-9 via chain)
      '  .toString();', // 9 — starts with .
      'do {', // 10 ✓
      '}', // 11
      'while (false);', // 12 — blocked keyword (do-while tail safety)
      'const sum = 1 +', // 13 ✓ (trailing continuation)
      '  2;', // 14 — previous line did not end its statement
    ].join('\n');
    expect(detectJSStatementStartLines(code)).toEqual([1, 4, 8, 10, 13]);
  });

  it('ignores blank and comment-only lines without breaking the chain', () => {
    const code = [
      '// @time', // 1 — comment only
      'const a = 1;', // 2 ✓
      '', // 3
      '/* block */', // 4 — comment only
      'const b = 2;', // 5 ✓
    ].join('\n');
    expect(detectJSStatementStartLines(code)).toEqual([2, 5]);
  });

  it('does not instrument directive-prologue string literals', () => {
    const code = [
      "'use strict';",
      '"use client";',
      'const answer = 42;',
      "'a later string expression';",
    ].join('\n');
    const lines = detectJSStatementStartLines(code);
    expect(lines).toEqual([3, 4]);
    expect(transformJSLineTiming(code, lines)).toBe(
      "'use strict';\n\"use client\";\n__mc_tick(3); const answer = 42;\n__mc_tick(4); 'a later string expression';"
    );
  });
});

describe('transformJSLineTiming (RL-115)', () => {
  it('prefixes targets in place and preserves the line count', () => {
    const code = ['const a = 1;', '  indented();', 'const b = 2;'].join('\n');
    const out = transformJSLineTiming(code, [1, 3]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('__mc_tick(1); const a = 1;');
    expect(lines[1]).toBe('  indented();');
    expect(lines[2]).toBe('__mc_tick(3); const b = 2;');
  });

  it('keeps the indent ahead of the marker', () => {
    const out = transformJSLineTiming('  work();', [1]);
    expect(out).toBe('  __mc_tick(1); work();');
  });

  it('returns the buffer unchanged with no targets', () => {
    expect(transformJSLineTiming('const x = 1;', [])).toBe('const x = 1;');
  });

  it('transformed output stays parseable JavaScript', () => {
    const code = [
      'const rows = [1, 2, 3];',
      'const doubled = rows.map(row => row * 2);',
      'for (const row of doubled) {',
      '  String(row);',
      '}',
    ].join('\n');
    const lines = detectJSStatementStartLines(code);
    const out = transformJSLineTiming(code, lines);
    expect(() => new Function('__mc_tick', out)).not.toThrow();
  });
});
