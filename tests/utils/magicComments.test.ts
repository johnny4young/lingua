import { describe, it, expect } from 'vitest';
import {
  detectJSMagicComments,
  transformJSMagicComments,
  detectPythonMagicComments,
  transformPythonMagicComments,
  magicCommentKindsByLine,
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
