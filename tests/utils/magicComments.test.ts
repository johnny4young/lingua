import { describe, it, expect } from 'vitest';
import {
  detectJSMagicComments,
  transformJSMagicComments,
  detectPythonMagicComments,
  transformPythonMagicComments,
} from '@/utils/magicComments';

describe('JS/TS magic comments', () => {
  describe('detectJSMagicComments', () => {
    it('detects //=> at end of line', () => {
      const code = 'const x = 1;\nx; //=> should be 1';
      const results = detectJSMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ line: 2, expression: 'x;' });
    });

    it('detects //=> with spaces before arrow', () => {
      const code = 'Math.PI; // => pi value';
      const results = detectJSMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ line: 1, expression: 'Math.PI;' });
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
});

describe('Python magic comments', () => {
  describe('detectPythonMagicComments', () => {
    it('detects #=> at end of line', () => {
      const code = 'x = 1\nx #=> should be 1';
      const results = detectPythonMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ line: 2, expression: 'x' });
    });

    it('detects # => with spaces', () => {
      const code = 'len([1,2,3]) # => length';
      const results = detectPythonMagicComments(code);
      expect(results).toHaveLength(1);
      expect(results[0]!.expression).toBe('len([1,2,3])');
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
  });
});
