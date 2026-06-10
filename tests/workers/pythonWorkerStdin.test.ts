import { describe, expect, it } from 'vitest';
import { createStdinLineReader } from '@/workers/python-worker-stdin';

describe('python-worker stdin line reader', () => {
  it('hands out lines with the \\n terminator and EOFs with null', () => {
    const reader = createStdinLineReader('uno\ndos');
    expect(reader.total).toBe(2);
    expect(reader.read()).toBe('uno\n');
    expect(reader.read()).toBe('dos\n');
    expect(reader.read()).toBeNull();
    // Repeated reads after EOF stay null (Pyodide may poll again).
    expect(reader.read()).toBeNull();
    expect(reader.consumedCount()).toBe(2);
  });

  it('treats a trailing newline as a terminator, not an extra answer', () => {
    const reader = createStdinLineReader('a\nb\n');
    expect(reader.total).toBe(2);
    expect(reader.read()).toBe('a\n');
    expect(reader.read()).toBe('b\n');
    expect(reader.read()).toBeNull();
  });

  it('preserves deliberate empty answers in the middle of the buffer', () => {
    const reader = createStdinLineReader('first\n\nthird');
    expect(reader.total).toBe(3);
    expect(reader.read()).toBe('first\n');
    expect(reader.read()).toBe('\n');
    expect(reader.read()).toBe('third\n');
    expect(reader.read()).toBeNull();
  });

  it('is immediate EOF for an empty or undefined buffer', () => {
    // The empty-buffer reader is what the worker now installs on EVERY
    // run: bare input() must hit EOF (clean EOFError) instead of
    // Pyodide's stock prompt()-based handler, which does not exist in
    // a Worker and leaks ReferenceError noise to the renderer console.
    for (const value of [undefined, '']) {
      const reader = createStdinLineReader(value);
      expect(reader.total).toBe(0);
      expect(reader.read()).toBeNull();
      expect(reader.consumedCount()).toBe(0);
    }
  });

  it('counts consumption incrementally for the fold-G summary reply', () => {
    const reader = createStdinLineReader('x\ny\nz');
    expect(reader.consumedCount()).toBe(0);
    reader.read();
    expect(reader.consumedCount()).toBe(1);
    reader.read();
    reader.read();
    expect(reader.consumedCount()).toBe(3);
    reader.read();
    // EOF reads never over-count past the staged total.
    expect(reader.consumedCount()).toBe(3);
  });
});
