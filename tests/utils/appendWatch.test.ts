/**
 * implementation note — `appendWatch` helper coverage.
 *
 * Locks:
 *   - Idempotent when the line is already a watch.
 *   - Promotes `//=>` arrow → `// @watch` on the same expression.
 *   - Infers a sensible expression for naked statements.
 *   - Rejects empty / whitespace-only / comment-only lines.
 *   - Honors language-specific comment shape (`//` vs `#`).
 *   - Indentation preserved for Python watch insertion.
 */

import { describe, it, expect } from 'vitest';
import {
  appendWatchAtLine,
  appendWatchToLine,
  isAppendWatchSupported,
} from '@/utils/appendWatch';

describe('appendWatchToLine — JavaScript', () => {
  it('appends ` // @watch <expr>` for a naked statement', () => {
    expect(appendWatchToLine('counter', 'javascript')).toBe(
      'counter // @watch counter'
    );
  });

  it('strips trailing semicolons from the inferred expression', () => {
    expect(appendWatchToLine('counter;', 'javascript')).toBe(
      'counter; // @watch counter'
    );
  });

  it('is idempotent when the line is already a watch', () => {
    const line = 'counter // @watch counter';
    expect(appendWatchToLine(line, 'javascript')).toBe(line);
  });

  it('promotes an arrow line into a watch on the same expression', () => {
    expect(appendWatchToLine('counter //=> peek', 'javascript')).toBe(
      'counter // @watch counter'
    );
  });

  it('returns null for empty / whitespace-only lines', () => {
    expect(appendWatchToLine('', 'javascript')).toBeNull();
    expect(appendWatchToLine('   ', 'javascript')).toBeNull();
  });

  it('returns null for pure-comment lines', () => {
    expect(appendWatchToLine('// already a comment', 'javascript')).toBeNull();
  });

  it('returns null for JS / TS control-flow and jump statements', () => {
    expect(appendWatchToLine('if (ready) {', 'javascript')).toBeNull();
    expect(appendWatchToLine('function run() {', 'javascript')).toBeNull();
    expect(appendWatchToLine('return value;', 'typescript')).toBeNull();
    expect(appendWatchToLine('import value from "pkg";', 'typescript')).toBeNull();
  });
});

describe('appendWatchToLine — Python', () => {
  it('appends `  # @watch <expr>` (two spaces, PEP 8 inline)', () => {
    expect(appendWatchToLine('counter', 'python')).toBe(
      'counter  # @watch counter'
    );
  });

  it('promotes an arrow `#=>` into a watch', () => {
    expect(appendWatchToLine('counter  #=> peek', 'python')).toBe(
      'counter  # @watch counter'
    );
  });

  it('returns null for pure-comment lines', () => {
    expect(appendWatchToLine('# just a comment', 'python')).toBeNull();
  });

  it('returns null for control-flow header lines (would eat the body)', () => {
    expect(appendWatchToLine('if x > 0:', 'python')).toBeNull();
    expect(appendWatchToLine('for item in items:', 'python')).toBeNull();
    expect(appendWatchToLine('def fn():', 'python')).toBeNull();
    expect(appendWatchToLine('class Foo:', 'python')).toBeNull();
  });

  it('returns null for Python jump/import statements that would not execute the watch', () => {
    expect(appendWatchToLine('return value', 'python')).toBeNull();
    expect(appendWatchToLine('raise ValueError()', 'python')).toBeNull();
    expect(appendWatchToLine('from math import pi', 'python')).toBeNull();
  });
});

describe('appendWatchAtLine — full-buffer mutation', () => {
  it('updates the targeted line in a JS buffer', () => {
    const source = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const next = appendWatchAtLine(source, 2, 'javascript');
    expect(next).toBe(
      'const a = 1;\nconst b = 2; // @watch b\nconst c = 3;'
    );
  });

  it('updates the targeted line in a Python buffer + preserves indentation', () => {
    const source = 'def fn():\n    counter = 5\n    print(counter)';
    const next = appendWatchAtLine(source, 2, 'python');
    expect(next).toBe(
      'def fn():\n    counter = 5  # @watch counter\n    print(counter)'
    );
  });

  it('returns null when the line is out of range', () => {
    expect(appendWatchAtLine('x', 0, 'javascript')).toBeNull();
    expect(appendWatchAtLine('x', 99, 'javascript')).toBeNull();
  });

  it('returns null when the line has no expression to watch', () => {
    const source = 'const a = 1;\n\nconst c = 3;';
    expect(appendWatchAtLine(source, 2, 'javascript')).toBeNull();
  });
});

describe('isAppendWatchSupported', () => {
  it('returns true for JS / TS / Python', () => {
    expect(isAppendWatchSupported('javascript')).toBe(true);
    expect(isAppendWatchSupported('typescript')).toBe(true);
    expect(isAppendWatchSupported('python')).toBe(true);
  });
  it('returns false for everything else', () => {
    expect(isAppendWatchSupported('rust')).toBe(false);
    expect(isAppendWatchSupported('go')).toBe(false);
    expect(isAppendWatchSupported('json')).toBe(false);
    expect(isAppendWatchSupported('')).toBe(false);
  });
});
