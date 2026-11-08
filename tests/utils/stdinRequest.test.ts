import { describe, expect, it } from 'vitest';
import { sanitizeStdinRequest, splitStdinLines } from '../../src/renderer/utils/stdinRequest';

describe('stdin requests', () => {
  it('keeps a short message and a positive line from whatever the worker sent', () => {
    expect(sanitizeStdinRequest({ type: 'stdin-request', message: 'Name?', line: 3 })).toEqual({ message: 'Name?', line: 3 });
    expect(sanitizeStdinRequest({ message: 'x'.repeat(500), line: 0 })).toEqual({ message: 'x'.repeat(200) });
    expect(sanitizeStdinRequest({ message: 7, line: 2.5 })).toEqual({ message: '' });
    expect(sanitizeStdinRequest(null)).toEqual({ message: '' });
    expect(sanitizeStdinRequest({ message: 'pass\u202eword\u200b:' })).toEqual({ message: 'pass word :' });
    expect(sanitizeStdinRequest({ message: '😀'.repeat(300) }).message).toBe('😀'.repeat(200));
  });

  it('splits stdin as the workers read it', () => {
    expect(splitStdinLines('a\n\nb\n')).toEqual(['a', '', 'b']);
    expect(splitStdinLines('')).toEqual([]);
    expect(splitStdinLines(undefined)).toEqual([]);
  });
});
