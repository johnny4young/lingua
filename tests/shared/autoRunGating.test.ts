/**
 * RL-020 Slice 1 — auto-run gating heuristics.
 *
 * Coverage:
 *
 *   - `empty` reason for whitespace-only / empty buffers.
 *   - `ok` reason for non-JS/TS languages (Python / Go / Rust /
 *     JSON stay opaque this slice).
 *   - JS / TS `incomplete` cases: unbalanced brackets, open quotes,
 *     open template placeholders, trailing operators, trailing
 *     keywords, mid-block-comment.
 *   - JS / TS `ok` cases: short complete expressions, function
 *     declarations, top-level await, trailing comment after a
 *     complete statement.
 *   - Comment-only buffers stay `ok` (nothing to gate against —
 *     execution is a no-op so let it through).
 *   - Edge: `1 + 1` reads complete because the LAST token is `1`,
 *     not the trailing-operator `+`.
 *   - Edge: nested template `` `${ `b${1}` }` `` balances and reads
 *     complete.
 */

import { describe, it, expect } from 'vitest';
import { isLikelyComplete } from '#src/shared/autoRunGating';

describe('isLikelyComplete — language gating', () => {
  it('returns ok for non-JS/TS languages even on incomplete-looking buffers', () => {
    expect(isLikelyComplete('python', 'def f(')).toEqual({
      ready: true,
      reason: 'ok',
    });
    expect(isLikelyComplete('go', 'func main() {')).toEqual({
      ready: true,
      reason: 'ok',
    });
    expect(isLikelyComplete('rust', 'fn main() {')).toEqual({
      ready: true,
      reason: 'ok',
    });
    expect(isLikelyComplete('json', '{ "key":')).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('returns ok for unknown / future languages — fail-open by design', () => {
    expect(isLikelyComplete('elixir', 'def x do')).toEqual({
      ready: true,
      reason: 'ok',
    });
  });
});

describe('isLikelyComplete — empty buffers', () => {
  it('reports reason="empty" for an empty string', () => {
    expect(isLikelyComplete('javascript', '')).toEqual({
      ready: false,
      reason: 'empty',
    });
  });

  it('reports reason="empty" for whitespace-only buffers', () => {
    expect(isLikelyComplete('typescript', '   \n\n\t')).toEqual({
      ready: false,
      reason: 'empty',
    });
  });
});

describe('isLikelyComplete — JS/TS incomplete buffers', () => {
  const incompleteCases: Array<[string, string]> = [
    ['open paren', 'for (let i = 0; i < 3; i++'],
    ['open bracket', 'const arr = [1, 2,'],
    ['open brace', 'const obj = { a: 1,'],
    ['open single quote', "const greet = 'hello"],
    ['open single quote before newline', "const greet = 'hello\nconsole.log(greet)"],
    ['open double quote', 'const greet = "hello'],
    ['open double quote before newline', 'const greet = "hello\nconsole.log(greet)'],
    ['open template literal', 'const greet = `hello'],
    ['open template placeholder', 'const greet = `hello ${'],
    ['open block comment', 'const x = 1; /* TODO'],
    ['trailing plus', 'const x = 1 +'],
    ['trailing modulo', 'const x = 10 %'],
    ['trailing exponent', 'const x = 2 **'],
    ['trailing bitwise OR', 'const x = flag |'],
    ['trailing nullish assignment', 'value ??='],
    ['trailing equals', 'const x ='],
    ['trailing comma', 'const arr = [1, 2,]'.slice(0, -1)],
    ['trailing dot', 'foo.'],
    ['trailing logical AND', 'a &&'],
    ['trailing logical OR', 'a ||'],
    ['trailing question', 'cond ?'],
    ['trailing colon', 'cond ? a :'],
    ['trailing arrow', 'const f = () =>'],
    ['trailing const keyword', 'const'],
    ['trailing function keyword', 'function'],
    ['trailing return keyword', 'function f() { return'],
    ['trailing await keyword', 'await'],
    ['trailing async keyword', 'async'],
  ];

  for (const [label, source] of incompleteCases) {
    it(`flags incomplete: ${label}`, () => {
      expect(isLikelyComplete('javascript', source)).toEqual({
        ready: false,
        reason: 'incomplete',
      });
    });
  }

  it('also gates TypeScript with the same heuristic', () => {
    expect(isLikelyComplete('typescript', 'interface Foo {')).toEqual({
      ready: false,
      reason: 'incomplete',
    });
    expect(isLikelyComplete('typescript', 'type X = ')).toEqual({
      ready: false,
      reason: 'incomplete',
    });
  });
});

describe('isLikelyComplete — JS/TS complete buffers', () => {
  const completeCases: Array<[string, string]> = [
    ['simple assignment', 'const x = 1;'],
    ['simple expression', '1 + 1'],
    ['function declaration', 'function f() { return 1; }'],
    ['arrow with body', 'const f = (x) => x * 2;'],
    ['for loop', 'for (let i = 0; i < 3; i++) console.log(i);'],
    ['template literal balanced', 'const g = `hello ${name}`;'],
    [
      'nested template balanced',
      'const g = `outer ${`inner ${1}`} tail`;',
    ],
    ['line comment after expression', 'const x = 1; // TODO'],
    ['block comment after expression', 'const x = 1; /* note */'],
    ['interface declaration TS', 'interface Foo { bar: number; }'],
    [
      'console.log expression',
      "console.log('hello', { a: 1 }, [1, 2]);",
    ],
    [
      'string with embedded quote',
      "const greet = 'it\\'s ok';",
    ],
    [
      'multi-line function',
      'function add(a, b) {\n  return a + b;\n}',
    ],
    // Nested-brace template-placeholder regressions. The scanner
    // must keep its placeholder context open across inner `}`
    // tokens — first review pass found this exact bug.
    [
      'object literal inside template placeholder',
      'const g = `${{ a: 1 }}`;',
    ],
    [
      'JSON.stringify({...}) inside template placeholder',
      'const g = `result: ${JSON.stringify({ a: 1 })}`;',
    ],
    [
      'arrow returning an object inside template placeholder',
      'const g = `${items.map((x) => ({ id: x }))}`;',
    ],
  ];

  for (const [label, source] of completeCases) {
    it(`flags complete: ${label}`, () => {
      expect(isLikelyComplete('javascript', source)).toEqual({
        ready: true,
        reason: 'ok',
      });
    });
  }

  it('treats a comment-only buffer as ok (nothing to execute)', () => {
    expect(isLikelyComplete('javascript', '// just a note')).toEqual({
      ready: true,
      reason: 'ok',
    });
    expect(
      isLikelyComplete('javascript', '/* nothing here */')
    ).toEqual({ ready: true, reason: 'ok' });
  });
});

describe('isLikelyComplete — comment-stripping discipline', () => {
  it('does not let a trailing line comment poison the last-token sweep', () => {
    const code = 'const x = 1; // TODO: more later';
    expect(isLikelyComplete('javascript', code)).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('does not let a trailing block comment poison the last-token sweep', () => {
    const code = 'const x = 1; /* a longer note */';
    expect(isLikelyComplete('javascript', code)).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('keeps an UNCLOSED block comment as incomplete', () => {
    const code = 'const x = 1; /* still typing';
    expect(isLikelyComplete('javascript', code)).toEqual({
      ready: false,
      reason: 'incomplete',
    });
  });
});

describe('isLikelyComplete — Monaco auto-pair defense', () => {
  // Modern editors auto-insert the matching close bracket when the
  // user types `(`, `[`, `{`. The user perceives `for (let i = ` but
  // the buffer carries `for (let i = )`. These cases lock the gate's
  // ability to catch that user-visible incompleteness.
  const autoPairCases: Array<[string, string]> = [
    ['auto-paired paren after =', 'for (let i = )'],
    ['auto-paired paren after arrow', 'items.map((x) => )'],
    ['auto-paired paren after ===', 'if (x === )'],
    ['auto-paired brace after :', 'const obj = { a: }'],
    ['trailing keyword before close-paren', 'function f() { return  )'],
  ];

  for (const [label, source] of autoPairCases) {
    it(`flags incomplete: ${label} — ${JSON.stringify(source)}`, () => {
      expect(isLikelyComplete('javascript', source)).toEqual({
        ready: false,
        reason: 'incomplete',
      });
    });
  }

  it('does NOT flag valid empty-body arrows: `() => {}`', () => {
    expect(isLikelyComplete('javascript', 'const f = () => {};')).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('does NOT flag valid balanced groupings: `(a + b)`', () => {
    expect(isLikelyComplete('javascript', 'const x = (a + b);')).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('does NOT flag valid balanced array: `[1, 2]`', () => {
    expect(isLikelyComplete('javascript', 'const x = [1, 2];')).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('does NOT flag valid trailing commas before a close delimiter', () => {
    expect(
      isLikelyComplete(
        'typescript',
        [
          'sanitizeLogString(',
          '  value,',
          ');',
          'const pair = [1, 2,];',
          'const obj = { a: 1, };',
        ].join('\n')
      )
    ).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('does NOT pause a formatted sanitizer helper with regex literals and trailing commas', () => {
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

    expect(isLikelyComplete('typescript', code)).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('does NOT flag identifier whose suffix shadows a keyword: `piglet)`', () => {
    // `\b` word-boundary anchor must hold or `piglet)` would read as
    // trailing `let` keyword.
    expect(isLikelyComplete('javascript', 'const f = (piglet);')).toEqual({
      ready: true,
      reason: 'ok',
    });
  });
});

describe('isLikelyComplete — false-positive defenses', () => {
  it('does NOT flag "1 + 1" as incomplete (last token is "1")', () => {
    expect(isLikelyComplete('javascript', '1 + 1')).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('does NOT flag identifiers that happen to start with a reserved word', () => {
    // `awaiting` is an identifier whose suffix matches `await` — the
    // gate must treat it as a bare identifier (ready), not as a
    // trailing `await` keyword.
    expect(isLikelyComplete('javascript', 'const x = awaiting')).toEqual({
      ready: true,
      reason: 'ok',
    });
    // Same for an identifier ending in `let` substring.
    expect(isLikelyComplete('javascript', 'const piglet')).toEqual({
      ready: true,
      reason: 'ok',
    });
  });

  it('keeps strings + operators inside string literals from polluting the gate', () => {
    expect(
      isLikelyComplete('javascript', "const s = 'a + b ='")
    ).toEqual({ ready: true, reason: 'ok' });
  });

  it('does not let auto-pair-looking closers inside strings trip the gate', () => {
    expect(
      isLikelyComplete('javascript', "const s = 'value = )';")
    ).toEqual({ ready: true, reason: 'ok' });
    expect(
      isLikelyComplete('javascript', 'const s = "arrow => )";')
    ).toEqual({ ready: true, reason: 'ok' });
  });

  it('does not let raw template text trip the auto-pair sweep', () => {
    expect(
      isLikelyComplete('javascript', 'const s = `template = ) and => )`;')
    ).toEqual({ ready: true, reason: 'ok' });
  });

  it('does not let a `}` inside a template-placeholder leak out', () => {
    const code = 'const g = `hi ${"}"}`;';
    expect(isLikelyComplete('javascript', code)).toEqual({
      ready: true,
      reason: 'ok',
    });
  });
});
