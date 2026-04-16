import { describe, expect, it } from 'vitest';
import {
  buildExecutionMarkerEntry,
  buildInlineDecorationEntries,
  getExecutionErrorKey,
} from '@/utils/editorExecutionDecorations';

describe('editorExecutionDecorations helpers', () => {
  it('groups multiple line results into Monaco inline decoration entries', () => {
    expect(
      buildInlineDecorationEntries([
        { line: 2, value: 'hello', type: 'log' },
        { line: 2, value: 'careful', type: 'warn' },
        { line: 4, value: '42', type: 'result' },
        { line: 4, value: 'sum = 1', type: 'magic' },
      ])
    ).toEqual([
      { line: 2, content: '  // hello  // careful' },
      { line: 4, content: '  // => 42  // => sum = 1' },
    ]);
  });

  it('normalizes execution marker positions to the model bounds', () => {
    expect(
      buildExecutionMarkerEntry(
        { message: 'Boom', line: 12, column: 99 },
        5,
        () => 8
      )
    ).toEqual({
      startLineNumber: 5,
      endLineNumber: 5,
      startColumn: 8,
      endColumn: 8,
      message: 'Boom',
      severity: 'error',
    });

    expect(
      buildExecutionMarkerEntry(
        { message: 'Compile failed', line: 3 },
        5,
        () => 12
      )
    ).toEqual({
      startLineNumber: 3,
      endLineNumber: 3,
      startColumn: 1,
      endColumn: 12,
      message: 'Compile failed',
      severity: 'error',
    });
  });

  it('builds stable reveal keys only for location-aware errors', () => {
    expect(getExecutionErrorKey(null)).toBeNull();
    expect(getExecutionErrorKey({ message: 'Boom' })).toBeNull();
    expect(getExecutionErrorKey({ message: 'Boom', line: 4, column: 2 })).toBe('Boom:4:2');
  });
});
