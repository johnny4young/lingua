import { describe, expect, it } from 'vitest';
import { answerChange, lineAnswerDelta } from '@/components/Answer/answerDelta';
import type { RunAnswers } from '@/stores/resultStore';

const previous = (results: RunAnswers['results'], sources: Record<number, string> = {}): RunAnswers => ({ number: 6, results, sources });

describe('answerChange', () => {
  it('strikes the old number and says how far it moved', () => {
    expect(answerChange('-10.6', '-31.4')).toEqual({ kind: 'number', before: '-10.6', up: false, by: '20.8' });
    expect(answerChange('95', '96.9')).toEqual({ kind: 'number', before: '95', up: true, by: '1.9' });
  });

  it('names the dict key that moved most', () => {
    expect(answerChange("{'api': 40.9, 'db': 95.0}", "{'api': 41.0, 'db': 96.9}")).toEqual({ kind: 'key', key: 'db', up: true, by: '1.9' });
  });

  it('shows the first changed list item, old to new', () => {
    expect(answerChange('[92, 88, 118]', '[92, 88, 131]')).toEqual({ kind: 'item', at: '[2]', before: '118', after: '131' });
  });

  it('counts items when a collection grows or shrinks', () => {
    expect(answerChange('[1, 2]', '[1, 2, 3]')).toEqual({ kind: 'size', before: 2, after: 3 });
    expect(answerChange('{"a": 1}', '{"a": 1, "b": 2}')).toEqual({ kind: 'size', before: 1, after: 2 });
  });

  it('falls back to the old text and ignores equal values', () => {
    expect(answerChange('slowest path: api', 'slowest path: db')).toEqual({ kind: 'text', before: 'slowest path: api' });
    expect(answerChange('[1, 2]', '[1,2]')).toBeNull();
    expect(answerChange(' 4 ', '4')).toBeNull();
  });

  it('keeps the struck text to one short line', () => {
    const change = answerChange(`${'x'.repeat(40)}\nmore`, 'y');
    expect(change).toEqual({ kind: 'text', before: `${'x'.repeat(23)}…` });
  });
});

describe('lineAnswerDelta', () => {
  it('compares a line with the previous run and marks an edited line', () => {
    const delta = lineAnswerDelta(7, [{ line: 7, value: '[1, 131]', type: 'log' }], previous([{ line: 7, value: '[1, 118]', type: 'log' }], { 7: 'db = [1, 118]' }), 'db = [1, 131]');
    expect(delta).toEqual({ change: { kind: 'item', at: '[1]', before: '118', after: '131' }, edited: true });
  });

  it('compares the latest answer of a repeating line', () => {
    const delta = lineAnswerDelta(
      3,
      [
        { line: 3, value: '1', type: 'log' },
        { line: 3, value: '5', type: 'log' },
      ],
      previous([{ line: 3, value: '4', type: 'log' }], { 3: 'print(n)' }),
      'print(n)'
    );
    expect(delta).toEqual({ change: { kind: 'number', before: '4', up: true, by: '1' }, edited: false });
  });

  it('says nothing for new lines, errors, other channels or mixed answers', () => {
    const before = previous([{ line: 1, value: '1', type: 'log' }]);
    expect(lineAnswerDelta(2, [{ line: 2, value: '2', type: 'log' }], before, '')).toBeNull();
    expect(lineAnswerDelta(1, [{ line: 1, value: 'Boom', type: 'error' }], before, '')).toBeNull();
    expect(lineAnswerDelta(1, [{ line: 1, value: '2', type: 'warn' }], before, '')).toBeNull();
    expect(
      lineAnswerDelta(
        1,
        [
          { line: 1, value: '2', type: 'log', name: 'a' },
          { line: 1, value: '3', type: 'log', name: 'b' },
        ],
        before,
        ''
      )
    ).toBeNull();
  });
});
