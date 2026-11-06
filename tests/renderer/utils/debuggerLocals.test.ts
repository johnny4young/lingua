import { describe, expect, it } from 'vitest';
import { changedValuesLabel, localsChanges, localsOnLine, orderedLocals, pausedLineResults } from '../../../src/renderer/utils/debuggerLocals';

describe('debugger locals diff', () => {
  it('marks nothing on the first pause', () => {
    expect(localsChanges(null, { a: '1' }).size).toBe(0);
  });

  it('marks new and changed bindings with the value they had', () => {
    const changes = localsChanges({ arr: '[3]', pivot: '1' }, { arr: '[3]', pivot: '10', left: '[]' });
    expect(Object.fromEntries(changes)).toEqual({ pivot: { kind: 'changed', before: '1' }, left: { kind: 'new' } });
  });

  it('keeps the previous order and appends new names', () => {
    expect(orderedLocals({ b: '1', a: '1' }, { a: '2', c: '3', b: '1' })).toEqual([
      ['b', '1'],
      ['a', '2'],
      ['c', '3'],
    ]);
    expect(orderedLocals(undefined, { a: '1', b: '2' })).toEqual([
      ['a', '1'],
      ['b', '2'],
    ]);
  });

  it('labels the first changes on one line', () => {
    expect(changedValuesLabel(null, { a: '1' })).toBeNull();
    expect(changedValuesLabel({}, { a: 'x\n  y', b: 'z'.repeat(50), c: '3', d: '4' })).toBe(`a → x y  ·  b → ${'z'.repeat(39)}…  ·  c → 3  …`);
  });
});

describe('locals on a line', () => {
  const locals = { count: '1', label: "'a'", doubled: '42', name: "'Ada'", user: '{…}' };

  it('names the locals the code uses, once, in order', () => {
    expect(localsOnLine('count += doubled + count;', locals, 'javascript')).toEqual(['count', 'doubled']);
  });

  it('skips longer names, properties, strings and comments', () => {
    expect(localsOnLine("const counter = user.name + 'count'; // label", locals, 'javascript')).toEqual(['user']);
    expect(localsOnLine('print("count", doubled)  # label', locals, 'python')).toEqual(['doubled']);
    expect(localsOnLine('x = `count ${doubled} ${ { label }.label }`', locals, 'javascript')).toEqual(['doubled', 'label']);
    expect(localsOnLine("s = 'it\\'s count' + name", locals, 'javascript')).toEqual(['name']);
  });
});

describe('paused line results', () => {
  const code = ['let count = 1;', 'const doubled = count * 2;', 'console.log(doubled, count);'].join('\n');
  const pause = (line: number, locals: Record<string, string>, tabId = 't1') => ({ tabId, line, locals });

  it('shows the locals of the paused line on the first pause', () => {
    expect(pausedLineResults(pause(2, { count: '1' }), null, code, 'javascript')).toEqual([{ line: 2, name: 'count', value: '1', type: 'log' }]);
  });

  it('adds what the step changed on the line it stepped from', () => {
    expect(pausedLineResults(pause(3, { count: '1', doubled: '2' }), pause(2, { count: '1' }), code, 'javascript')).toEqual([
      { line: 3, name: 'doubled', value: '2', type: 'log' },
      { line: 3, name: 'count', value: '1', type: 'log' },
      { line: 2, name: 'doubled', value: '2', type: 'log' },
    ]);
  });

  it('merges a loop that pauses on the same line, and ignores another tab and lines that are not lines', () => {
    expect(pausedLineResults(pause(1, { count: '2', i: '1' }), pause(1, { count: '1' }), code, 'javascript')).toEqual([
      { line: 1, name: 'count', value: '2', type: 'log' },
      { line: 1, name: 'i', value: '1', type: 'log' },
    ]);
    expect(pausedLineResults(pause(2, { count: '2' }), pause(1, { count: '1' }, 't2'), code, 'javascript')).toEqual([{ line: 2, name: 'count', value: '2', type: 'log' }]);
    expect(pausedLineResults(pause(9, { count: '2' }), pause(0.5, {}), code, 'javascript')).toEqual([]);
  });
});
