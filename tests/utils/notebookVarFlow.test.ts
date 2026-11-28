import { describe, expect, it } from 'vitest';
import type { NotebookCellV1 } from '../../src/shared/notebook';
import { deriveUsesKeys, pythonMadeNames, restoredPythonVarFlow } from '../../src/renderer/utils/notebookVarFlow';

const python = (id: string, source: string, answered = true): NotebookCellV1 => ({
  kind: 'code',
  id,
  language: 'python',
  source,
  outputs: [],
  ...(answered ? { answers: [] } : {}),
});

describe('pythonMadeNames', () => {
  it('names definitions, import aliases and every assignment target at module level', () => {
    const source = [
      'import os, numpy as np',
      'import os.path',
      'from statistics import mean, median as mid',
      'from typing import (',
      '    Any,',
      '    Optional as Opt,',
      ')',
      'from math import *',
      '@cache',
      'def total(xs): return sum(xs)',
      'async def fetch(): pass',
      'class Box:',
      '    inner = 1',
      'a = b = c = 0',
      'first, *rest = [1, 2, 3]',
      '(p, q), r = (1, 2), 3',
      'width: int = 4',
      'height: int',
      'count += 1',
      'items[0] = 1',
      'obj.attr = 2',
      'f = lambda x=1: x',
      'if a == b: hidden = 1',
      'for i in range(3): pass',
    ].join('\n');
    expect(pythonMadeNames(source)).toEqual([
      'np',
      'mid',
      'Opt',
      'total',
      'fetch',
      'Box',
      'a',
      'b',
      'c',
      'first',
      'rest',
      'p',
      'q',
      'r',
      'width',
      'count',
      'f',
    ]);
  });

  it('skips strings, comments and names inside brackets or blocks', () => {
    const source = [
      'note = """',
      'fake = 1',
      '"""',
      "label = 'x = 1'  # y = 2",
      'total = sum(',
      '    v for v in data',
      ')',
      'def run():',
      '    local = 3',
      'one = 1; two = 2',
      "x == 1",
    ].join('\n');
    expect(pythonMadeNames(source)).toEqual(['note', 'label', 'total', 'run', 'one', 'two']);
  });

  it('reads match and case as names unless they open a block, and keeps one-line block bodies out', () => {
    const source = [
      'match = re.search(pattern, text)',
      'case = 1',
      'match command:',
      '    case "go": moved = 1',
      'if ready: a = 1; b = 2',
      'def f(): x = 1; y = 2',
      'key = lambda item, default=0: item',
      'c = 3; d = 4',
    ].join('\n');
    expect(pythonMadeNames(source)).toEqual(['match', 'case', 'f', 'key', 'c', 'd']);
  });
});

describe('deriveUsesKeys', () => {
  it('keeps names the cells above made, ignoring Python strings and comments but not f-strings', () => {
    const source = 'print("greet")  # avg\nprint(f"{tickets[0]}")\nBox()';
    expect(deriveUsesKeys(source, ['greet', 'avg', 'tickets', 'Box'], 'python')).toEqual(['tickets', 'Box']);
  });

  it('folds SQL names and drops their schema', () => {
    expect(deriveUsesKeys('SELECT * FROM main.BY_CITY', ['by_city'], 'sql')).toEqual(['by_city']);
  });
});

describe('restoredPythonVarFlow', () => {
  it('reads the chips of Python cells that ran before this session from their source', () => {
    const cells = [
      python('a', 'import math as m\ndef greet(n): print(n)'),
      python('b', 'greet("ana")\nx = m.pi'),
      python('c', 'y = x', false),
    ];
    const flow = restoredPythonVarFlow(cells, undefined, undefined, undefined);
    expect(flow).toEqual({
      a: { uses: [], produces: ['m', 'greet'] },
      b: { uses: ['greet', 'm'], produces: ['x'] },
    });
  });

  it('keeps what a run in this session recorded and returns the same map when nothing is restored', () => {
    const cells = [python('a', 'x = 1'), python('b', 'y = x')];
    const current = { a: { uses: [], produces: ['x'] }, b: { uses: ['x'], produces: ['y'] } };
    expect(restoredPythonVarFlow(cells, current, undefined, undefined)).toBe(current);
    const partial = { a: { uses: [], produces: ['renamed'] } };
    expect(restoredPythonVarFlow(cells, partial, undefined, undefined)?.b).toEqual({ uses: [], produces: ['y'] });
  });
});
