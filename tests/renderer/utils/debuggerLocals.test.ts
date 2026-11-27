import { describe, expect, it } from 'vitest';
import { callOnLine, changedValuesLabel, localsChanges, localsOnLine, orderedLocals, pausedLineResults } from '../../../src/renderer/utils/debuggerLocals';
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

describe('paused frames on the lines they ran', () => {
  const sort = [
    'function quickSort(arr) {',
    '  if (arr.length <= 1) return arr;',
    '  const pivot = arr[Math.floor(arr.length / 2)];',
    '  const left = arr.filter((x) => x < pivot);',
    '  const mid = arr.filter((x) => x === pivot);',
    '  const right = arr.filter((x) => x > pivot);',
    '  return [...quickSort(left), ...mid, ...quickSort(right)];',
    '}',
    '',
    'const nums = [3, 6, 8, 10, 1, 2, 1];',
    'console.log(quickSort(nums));',
  ].join('\n');
  const deep = {
    tabId: 't1',
    line: 4,
    locals: { arr: '[3,6,8,1,2,1]', pivot: '1' },
    depth: 2,
    frame: 'quickSort',
    callStack: [
      { functionName: 'quickSort', line: 4, declarationLine: 1, callIndex: 1 },
      { functionName: 'quickSort', line: 7, declarationLine: 1, callIndex: 1 },
      { functionName: '<module>', line: 11 },
    ],
    frameLines: [2, 3],
  };
  const first = { ...deep, locals: { arr: '[3,6,8,10,1,2,1]', pivot: '10' }, depth: 1, callStack: [deep.callStack[1]!, deep.callStack[2]!] };

  it('says what each caller waits on and what the top level called, as another frame', () => {
    const results = pausedLineResults(deep, null, sort, 'javascript');
    expect(results.filter(result => result.frameCall)).toEqual([
      { line: 7, value: 'quickSort(left)', type: 'log', depth: 1, frameCall: { kind: 'waiting', thisCall: true } },
      { line: 11, value: 'quickSort → quickSort', type: 'log', frameCall: { kind: 'calling', depth: 2 } },
    ]);
  });

  it('answers the lines the paused frame already ran with the current value of the locals they name first', () => {
    const results = pausedLineResults(deep, first, sort, 'javascript');
    expect(results.filter(result => !result.held && !result.frameCall)).toEqual([
      { line: 1, name: 'arr', value: '[3,6,8,1,2,1]', type: 'log', previous: '[3,6,8,10,1,2,1]' },
      { line: 3, name: 'pivot', value: '1', type: 'log', previous: '10' },
    ]);
    // Changes since last pause off: the same lines answer without the struck value.
    expect(pausedLineResults(deep, first, sort, 'javascript', false).filter(result => result.line < 4)).toEqual([
      { line: 1, name: 'arr', value: '[3,6,8,1,2,1]', type: 'log' },
      { line: 3, name: 'pivot', value: '1', type: 'log' },
    ]);
  });

  it('keeps the paused line held and the line stepped from on what changed', () => {
    const stepped = { ...deep, line: 5, locals: { ...deep.locals, left: '[]' }, frameLines: [2, 3, 4] };
    const results = pausedLineResults(stepped, deep, sort, 'javascript');
    expect(results.filter(result => result.line === 5)).toEqual([
      { line: 5, name: 'arr', value: '[3,6,8,1,2,1]', type: 'log', held: true },
      { line: 5, name: 'pivot', value: '1', type: 'log', held: true },
    ]);
    expect(results.filter(result => result.line === 4)).toEqual([{ line: 4, name: 'left', value: '[]', type: 'log' }]);
  });

  it('leaves lines this invocation never ran without an answer', () => {
    const results = pausedLineResults({ ...deep, frameLines: [3] }, null, sort, 'javascript');
    expect(results.map(result => result.line).sort((a, b) => a - b)).toEqual([1, 3, 4, 4, 7, 11]);
    expect(pausedLineResults({ ...deep, frameLines: undefined }, null, sort, 'javascript').some(result => result.line < 4)).toBe(false);
  });

  it('keeps a recursive caller off the paused line when that line names no local', () => {
    const code = ['function go() {', '  if (--count > 0) go();', '}', 'go();'].join('\n');
    const stack = [
      { functionName: 'go', line: 2, declarationLine: 1, callIndex: 1 },
      { functionName: 'go', line: 2, declarationLine: 1, callIndex: 1 },
      { functionName: '<module>', line: 4 },
    ];
    const results = pausedLineResults({ tabId: 't1', line: 2, locals: {}, depth: 2, frame: 'go', callStack: stack }, null, code, 'javascript');
    expect(results.some(result => result.line === 2)).toBe(false);
  });

  it('answers a top-level pause on the top-level lines that ran', () => {
    const atTop = { tabId: 't1', line: 11, locals: { nums: '[3]' }, depth: 0, callStack: [{ functionName: '<module>', line: 11 }], frameLines: [10, 12] };
    expect(pausedLineResults(atTop, null, sort, 'javascript')).toEqual([
      { line: 11, name: 'nums', value: '[3]', type: 'log', held: true },
      { line: 10, name: 'nums', value: '[3]', type: 'log' },
    ]);
  });

  it('reads which call a caller waits on from the call index, and folds a long chain', () => {
    const line = '  return [...quickSort(left), ...mid, ...quickSort(right)];';
    expect(callOnLine(line, 'quickSort', 2, 'javascript')).toBe('quickSort(right)');
    // A call started on a later line of the statement is not on this one.
    expect(callOnLine(line, 'quickSort', 5, 'javascript')).toBe('quickSort(…)');
    expect(callOnLine('out = merge(mergeSort(a),  b);', 'merge', 1, 'javascript')).toBe('merge(mergeSort(a), b)');
    expect(callOnLine('x = "go(1)" + go(veryLongArgumentNameThatKeepsGoing, another)', 'go', 1, 'javascript')).toBe('go(…)');
    expect(callOnLine('box.size([n])', 'Box.size', 1, 'javascript')).toBe('size([n])');
    expect(callOnLine('run()', '<anonymous>', 1, 'javascript')).toBe('<anonymous>(…)');
    // A runtime without call indexes cannot tell two calls apart, and Rust paths name the function last.
    expect(callOnLine(line, 'quickSort', undefined, 'python')).toBe('quickSort(…)');
    expect(callOnLine('    total = fib(n)', 'demo::fib', undefined, 'rust')).toBe('fib(n)');
    const stack = ['d', 'c', 'b', 'a'].map((name, index) => ({ functionName: name, line: 7 - index, declarationLine: 1 }));
    const chain = pausedLineResults(
      { ...deep, depth: 4, callStack: [...stack, { functionName: '<module>', line: 11 }], frameLines: [] },
      null,
      sort,
      'javascript'
    ).find(result => result.frameCall?.kind === 'calling');
    expect(chain?.value).toBe('a → … → d');
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
