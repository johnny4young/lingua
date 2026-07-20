import { describe, expect, it } from 'vitest';
import {
  isClickable,
  parseJsErrorStack,
  parsePythonTraceback,
} from '../../src/shared/errorStack';

describe('parseJsErrorStack', () => {
  it('returns empty array for missing input', () => {
    expect(parseJsErrorStack(undefined)).toEqual([]);
    expect(parseJsErrorStack('')).toEqual([]);
  });

  it('parses V8 with-name frames', () => {
    const stack = [
      'Error: boom',
      '    at handler (/Users/me/proj/file.ts:12:7)',
      '    at main (/Users/me/proj/index.ts:3:5)',
    ].join('\n');
    const frames = parseJsErrorStack(stack);
    expect(frames).toHaveLength(3);
    // Header
    expect(frames[0]).toMatchObject({ text: 'Error: boom' });
    expect(frames[0].file).toBeUndefined();
    // First frame
    expect(frames[1]).toMatchObject({
      fnName: 'handler',
      file: '/Users/me/proj/file.ts',
      line: 12,
      column: 7,
    });
    // Second frame
    expect(frames[2]).toMatchObject({
      fnName: 'main',
      file: '/Users/me/proj/index.ts',
      line: 3,
      column: 5,
    });
  });

  it('parses V8 without-name (bare) frames', () => {
    const stack = ['Error: x', '    at /tmp/script.js:1:1'].join('\n');
    const frames = parseJsErrorStack(stack);
    expect(frames[1]).toMatchObject({
      file: '/tmp/script.js',
      line: 1,
      column: 1,
    });
    expect(frames[1].fnName).toBeUndefined();
  });

  it('parses SpiderMonkey frames', () => {
    const stack = 'handler@/Users/me/x.js:10:3\n@/Users/me/x.js:1:0';
    const frames = parseJsErrorStack(stack);
    expect(frames[0]).toMatchObject({
      fnName: 'handler',
      file: '/Users/me/x.js',
      line: 10,
      column: 3,
    });
    // The anonymous-toplevel frame retains the file/line/column;
    // `fnName` is intentionally absent because nothing precedes `@`.
    expect(frames[1].fnName).toBeUndefined();
    expect(frames[1].file).toBe('/Users/me/x.js');
  });

  it('keeps unrecognised lines as text-only frames', () => {
    const stack = 'Error: boom\nat eval (eval at <anonymous> (:1:1))';
    const frames = parseJsErrorStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[1].file).toBeUndefined();
    expect(frames[1].line).toBeUndefined();
    expect(frames[1].text).toContain('eval');
  });

  it('survives malformed input without throwing', () => {
    expect(() => parseJsErrorStack('not a stack')).not.toThrow();
    expect(() => parseJsErrorStack('at :NaN:NaN')).not.toThrow();
  });

  it('demotes eval-internal worker frames to text-only ', () => {
    // The actual frame Lingua's AsyncFunction-in-Worker pipeline
    // produces when user code throws. The greedy regex captures the
    // worker URL as `file` — but no editor can open it. Mark as
    // text-only and keep the function name in the text.
    const stack = [
      'Error: boom',
      'at inner (eval at <anonymous> (http://localhost:5174/src/renderer/workers/js-worker.ts?worker_file&type=module:614:16), <anonymous>:36:26)',
      'at outer (eval at <anonymous> (http://localhost:5174/src/renderer/workers/js-worker.ts?worker_file&type=module:614:16), <anonymous>:37:20)',
    ].join('\n');
    const frames = parseJsErrorStack(stack);
    // Header + 2 eval-internal frames.
    expect(frames).toHaveLength(3);
    // Both eval frames must be text-only (no file/line/column).
    expect(frames[1].file).toBeUndefined();
    expect(frames[1].line).toBeUndefined();
    expect(frames[1].column).toBeUndefined();
    // Function name preserved in fnName + visible in text.
    expect(frames[1].fnName).toBe('inner');
    expect(frames[1].text).toContain('inner');
    expect(frames[2].fnName).toBe('outer');
  });

  it('still treats genuine user-source frames as clickable', () => {
    // A non-eval frame with a real-looking file path stays clickable.
    const stack = [
      'Error: boom',
      'at runJob (/Users/me/proj/src/job.ts:42:7)',
    ].join('\n');
    const frames = parseJsErrorStack(stack);
    expect(frames[1]).toMatchObject({
      fnName: 'runJob',
      file: '/Users/me/proj/src/job.ts',
      line: 42,
      column: 7,
    });
  });
});

describe('parsePythonTraceback', () => {
  it('returns empty array for missing input', () => {
    expect(parsePythonTraceback(undefined)).toEqual([]);
    expect(parsePythonTraceback('')).toEqual([]);
  });

  it('parses a canonical Python traceback', () => {
    const tb = [
      'Traceback (most recent call last):',
      '  File "<stdin>", line 1, in <module>',
      '  File "/usr/local/lib/python3.11/site-packages/foo.py", line 42, in bar',
      '    raise ValueError("boom")',
      'ValueError: boom',
    ].join('\n');
    const frames = parsePythonTraceback(tb);
    // Header + 2 File frames (each followed by a continuation text where present)
    const fileFrames = frames.filter((frame) => typeof frame.file === 'string');
    expect(fileFrames).toHaveLength(2);
    expect(fileFrames[0]).toMatchObject({
      file: '<stdin>',
      line: 1,
      fnName: '<module>',
    });
    expect(fileFrames[1]).toMatchObject({
      file: '/usr/local/lib/python3.11/site-packages/foo.py',
      line: 42,
      fnName: 'bar',
    });
    // The "raise ValueError" source line is captured as text-only
    const sourceLine = frames.find((frame) =>
      frame.text.includes('raise ValueError')
    );
    expect(sourceLine).toBeDefined();
    expect(sourceLine?.file).toBeUndefined();
  });

  it('handles File line without `in fn` suffix', () => {
    const tb = '  File "x.py", line 5\n    some_code()';
    const frames = parsePythonTraceback(tb);
    const fileFrame = frames.find((frame) => frame.file === 'x.py');
    expect(fileFrame).toBeDefined();
    expect(fileFrame?.fnName).toBeUndefined();
    expect(fileFrame?.line).toBe(5);
  });

  it('survives malformed input', () => {
    expect(() => parsePythonTraceback('Traceback (no frames)')).not.toThrow();
  });

  // implementation-β-β-α implementation note — PEP 3134 cause chain awareness.

  it('tags explicit `raise … from …` cause separator with causedBy: cause', () => {
    const tb = [
      'Traceback (most recent call last):',
      '  File "<stdin>", line 1, in <module>',
      '    raise RuntimeError("outer") from inner',
      'RuntimeError: outer',
      '',
      'The above exception was the direct cause of the following exception:',
      '',
      'Traceback (most recent call last):',
      '  File "<stdin>", line 3, in <module>',
      '    raise inner',
      'ValueError: inner',
    ].join('\n');
    const frames = parsePythonTraceback(tb);
    const causeFrame = frames.find((frame) => frame.causedBy === 'cause');
    expect(causeFrame).toBeDefined();
    expect(causeFrame?.text).toContain(
      'The above exception was the direct cause of the following exception'
    );
    // Cause separator frames are non-clickable.
    expect(causeFrame?.file).toBeUndefined();
    expect(causeFrame?.line).toBeUndefined();
    // Both segments produce their own File frames (one before + one
    // after the marker).
    const fileFrames = frames.filter((frame) => typeof frame.file === 'string');
    expect(fileFrames.length).toBeGreaterThanOrEqual(2);
  });

  it('tags implicit re-raise separator with causedBy: context', () => {
    const tb = [
      'Traceback (most recent call last):',
      '  File "<stdin>", line 1, in <module>',
      'KeyError: "k"',
      '',
      'During handling of the above exception, another exception occurred:',
      '',
      'Traceback (most recent call last):',
      '  File "<stdin>", line 5, in <module>',
      'RuntimeError: oh no',
    ].join('\n');
    const frames = parsePythonTraceback(tb);
    const contextFrame = frames.find((frame) => frame.causedBy === 'context');
    expect(contextFrame).toBeDefined();
    expect(contextFrame?.text).toContain('During handling of the above exception');
  });

  it('does not swallow a PEP 3134 marker that appears immediately after a File frame', () => {
    // Defensive — real Python tracebacks never produce this shape, but a
    // hand-formatted or third-party traceback could omit the source line.
    // The marker must keep its causedBy discriminator instead of being
    // consumed as a non-clickable continuation text frame.
    const tb = [
      'Traceback (most recent call last):',
      '  File "<stdin>", line 1, in <module>',
      'The above exception was the direct cause of the following exception:',
      'Traceback (most recent call last):',
      '  File "<stdin>", line 3, in <module>',
    ].join('\n');
    const frames = parsePythonTraceback(tb);
    const causeFrame = frames.find((frame) => frame.causedBy === 'cause');
    expect(causeFrame).toBeDefined();
    // First File frame produced its own frame; the marker survives as
    // a typed separator, not as a text-only continuation.
    const fileFrames = frames.filter((frame) => typeof frame.file === 'string');
    expect(fileFrames.length).toBe(2);
  });
});

describe('isClickable', () => {
  it('requires both file and line', () => {
    expect(isClickable({ text: '', file: 'x.ts', line: 1 })).toBe(true);
    expect(isClickable({ text: '', file: 'x.ts' })).toBe(false);
    expect(isClickable({ text: '', line: 1 })).toBe(false);
    expect(isClickable({ text: '' })).toBe(false);
    // Empty file rejected (parser may emit '' in edge cases).
    expect(isClickable({ text: '', file: '', line: 1 })).toBe(false);
  });
});
