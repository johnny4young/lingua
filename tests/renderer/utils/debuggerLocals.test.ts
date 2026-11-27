import { describe, expect, it } from 'vitest';
import { changedValuesLabel, localsChanges, localsOnLine, orderedLocals, pausedLineResults } from '../../../src/renderer/utils/debuggerLocals';
import { pauseDepth, stackRows } from '../../../src/renderer/utils/debuggerStack';

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
  const pause = (line: number, locals: Record<string, string>, tabId = 't1', depth = 0) => ({ tabId, line, locals, depth });

  it('holds the locals of the paused line on the first pause', () => {
    expect(pausedLineResults(pause(2, { count: '1' }), null, code, 'javascript')).toEqual([{ line: 2, name: 'count', value: '1', type: 'log', held: true }]);
  });

  it('adds what the step changed on the line it stepped from', () => {
    expect(pausedLineResults(pause(3, { count: '1', doubled: '2' }), pause(2, { count: '1' }), code, 'javascript')).toEqual([
      { line: 3, name: 'doubled', value: '2', type: 'log', held: true },
      { line: 3, name: 'count', value: '1', type: 'log', held: true },
      { line: 2, name: 'doubled', value: '2', type: 'log' },
    ]);
  });

  it('carries the value a local held at the previous pause, unless changes are off', () => {
    expect(pausedLineResults(pause(1, { count: '2', i: '1' }), pause(1, { count: '1' }), code, 'javascript')).toEqual([
      { line: 1, name: 'count', value: '2', type: 'log', held: true, previous: '1' },
      { line: 1, name: 'i', value: '1', type: 'log' },
    ]);
    expect(pausedLineResults(pause(1, { count: '2' }), pause(1, { count: '1' }), code, 'javascript', false)).toEqual([
      { line: 1, name: 'count', value: '2', type: 'log', held: true },
    ]);
  });

  it('shows the values an earlier pause read in another frame with its depth', () => {
    expect(pausedLineResults(pause(1, { count: '5' }, 't1', 2), pause(2, { count: '1', doubled: '9' }, 't1', 1), code, 'javascript')).toEqual([
      { line: 1, name: 'count', value: '5', type: 'log', held: true, previous: '1' },
      { line: 2, name: 'doubled', value: '9', type: 'log', depth: 1 },
      { line: 2, name: 'count', value: '1', type: 'log', depth: 1 },
    ]);
  });

  it('treats a sibling call at the same depth as another frame, and does not repeat a line the pause holds', () => {
    const inF = { ...pause(2, { count: '1', doubled: '9' }, 't1', 1), frame: 'f' };
    const inG = { ...pause(1, { count: '5' }, 't1', 1), frame: 'g' };
    expect(pausedLineResults(inG, inF, code, 'javascript', false)).toEqual([
      { line: 1, name: 'count', value: '5', type: 'log', held: true },
      { line: 2, name: 'doubled', value: '9', type: 'log', depth: 1 },
      { line: 2, name: 'count', value: '1', type: 'log', depth: 1 },
    ]);
    expect(pausedLineResults(pause(2, { count: '2' }, 't1', 2), pause(2, { count: '3' }, 't1', 1), code, 'javascript')).toEqual([
      { line: 2, name: 'count', value: '2', type: 'log', held: true, previous: '3' },
    ]);
  });

  it('strikes a previous value only from the same function', () => {
    const inF = { ...pause(1, { count: '2' }, 't1', 1), frame: 'f' };
    const inG = { ...pause(1, { count: '5' }, 't1', 1), frame: 'g' };
    expect(pausedLineResults(inG, inF, code, 'javascript')).toEqual([{ line: 1, name: 'count', value: '5', type: 'log', held: true }]);
    expect(pausedLineResults({ ...inF, depth: 2 }, { ...inF, locals: { count: '1' } }, code, 'javascript')[0]).toMatchObject({ previous: '1' });
  });

  it('ignores another tab and lines that are not lines', () => {
    expect(pausedLineResults(pause(2, { count: '2' }), pause(1, { count: '1' }, 't2'), code, 'javascript')).toEqual([
      { line: 2, name: 'count', value: '2', type: 'log', held: true },
    ]);
    expect(pausedLineResults(pause(9, { count: '2' }), pause(0.5, {}), code, 'javascript')).toEqual([]);
  });
});

describe('call stack rows', () => {
  it('reads the stack outermost first at each frame\'s line, leaving out a line the runtime has not set', () => {
    const stack = [
      { functionName: 'inner', line: 4 },
      { functionName: 'outer', line: 9 },
      { functionName: '<module>', line: 23 },
    ];
    expect(stackRows(stack)).toEqual([
      { functionName: '<module>', line: 23 },
      { functionName: 'outer', line: 9 },
      { functionName: 'inner', line: 4 },
    ]);
    expect(stackRows([{ functionName: '<module>', line: 0 }])).toEqual([{ functionName: '<module>' }]);
    expect(pauseDepth(stack)).toBe(2);
    expect(pauseDepth([])).toBe(0);
  });
});
