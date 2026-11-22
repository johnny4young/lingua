import { describe, expect, it } from 'vitest';
import * as answers from '@/utils/lastAnswer';
import { promptAnswer, runsOnPause, toOneLine, valueKind } from '@/components/Start/startPromptModel';
import type { ExecutionResult } from '@/types/execution';

function result(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return { stdout: [], stderr: [], executionTime: 3, ...overrides };
}

describe('startPromptModel', () => {
  it('runs JS and TS on a pause and leaves other languages to Enter', () => {
    expect(runsOnPause('javascript')).toBe(true);
    expect(runsOnPause('typescript')).toBe(true);
    expect(runsOnPause('python')).toBe(false);
    expect(runsOnPause('go')).toBe(false);
    expect(runsOnPause('javascript', { jsTs: 'manual', pythonRuby: 'pause', goRust: 'manual' })).toBe(false);
    expect(runsOnPause('typescript', { jsTs: 'pause', pythonRuby: 'pause', goRust: 'manual' })).toBe(true);
  });

  it('turns pasted line breaks into single spaces and drops a trailing one', () => {
    expect(toOneLine('[1, 2]\n  .map(n => n * 2)\n')).toBe('[1, 2] .map(n => n * 2)');
    expect(toOneLine('a\r\nb')).toBe('a b');
    expect(toOneLine('one line')).toBe('one line');
  });

  it('tags values with the inline pill heuristic, never null or undefined', () => {
    expect(valueKind('[ 1, 4, 9 ]')).toBe('array');
    expect(valueKind('{ a: 1 }')).toBe('object');
    expect(valueKind('42')).toBe('number');
    expect(valueKind('true')).toBe('boolean');
    expect(valueKind('HOLA')).toBe('string');
    expect(valueKind('null')).toBeUndefined();
    expect(valueKind('undefined')).toBeUndefined();
  });

  it('answers with the evaluated array as a range, its bars and its length', () => {
    const shown = promptAnswer(
      answers,
      '[1, 2, 3, 4, 5, 6, 7, 8].map(n => n * n)',
      result({ magicResults: [{ line: 1, value: '[ 1, 4, 9, 16, 25, 36, 49, 64 ]', kind: 'autoLog' }] }),
      100
    );
    expect(shown.valueKind).toBe('array');
    expect(shown.answer).toMatchObject({ status: 'ok', numeral: '1 – 64', unit: 'items', total: 8, ranAt: 100 });
    expect(shown.answer.picture?.kind).toBe('bars');
  });

  it('answers a print with what it printed, not the undefined it evaluated to', () => {
    const shown = promptAnswer(
      answers,
      'console.log(42)',
      result({
        magicResults: [{ line: 1, value: 'undefined', kind: 'autoLog' }],
        stdout: [{ type: 'log', args: ['42'], line: 1 }],
      }),
      100
    );
    expect(shown.answer.numeral).toBe('42');
    expect(shown.valueKind).toBeUndefined();
  });

  it('names the error a captured expression threw', () => {
    const shown = promptAnswer(
      answers,
      'x',
      result({
        magicResults: [
          { line: 1, value: 'ReferenceError: x is not defined', kind: 'autoLog', isError: true, error: { message: 'x is not defined' } },
        ],
      }),
      100
    );
    expect(shown.answer).toMatchObject({ status: 'error', numeral: '', label: 'ReferenceError' });
    expect(shown.valueKind).toBeUndefined();
  });
});
