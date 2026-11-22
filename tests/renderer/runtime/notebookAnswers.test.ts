/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'acorn';
import {
  finalizeAnswers,
  instrumentJsAnswers,
  jsAnswers,
  pythonAnswers,
  pythonValueType,
  sqlAnswerTarget,
  sqlErrorLine,
} from '../../../src/renderer/runtime/notebookAnswers';
import { MAX_ANSWER_TEXT_LENGTH } from '../../../src/shared/notebook';
import type { ExecutionResult } from '../../../src/renderer/types/execution';

function parses(source: string): boolean {
  try {
    parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
    return true;
  } catch {
    return false;
  }
}

describe('instrumentJsAnswers', () => {
  it('wraps each top-level expression with its line and keeps the line count', () => {
    const source = "const usd = n => `$${n}`;\nconsole.log('ready')\n\nusd(\n  818294.4\n)";
    const out = instrumentJsAnswers(source);
    expect(out.split('\n')).toHaveLength(source.split('\n').length);
    expect(out).toContain("__notebook_answer(2, (console.log('ready')))");
    expect(out).toContain('__notebook_answer(4, (usd(');
    expect(out).toContain('const usd = n => `$${n}`;');
    expect(parses(out)).toBe(true);
  });

  it('leaves declarations, nested statements and directives alone', () => {
    const source = '"use strict";\nlet x = 1;\nif (x) { x + 1; }\nfunction f() { return 2; }';
    expect(instrumentJsAnswers(source)).toBe(source);
  });

  it('keeps await inside the wrapped expression', () => {
    const out = instrumentJsAnswers('await Promise.resolve(3)');
    expect(out).toBe('__notebook_answer(1, (await Promise.resolve(3)))');
    expect(parses(out)).toBe(true);
  });

  it('returns broken input unchanged', () => {
    expect(instrumentJsAnswers('const = 1')).toBe('const = 1');
  });
});

describe('finalizeAnswers', () => {
  it('keeps one answer per line and kind, the last write winning, and sorts by line', () => {
    const answers = finalizeAnswers(
      [
        { line: 3, kind: 'output', text: 'a' },
        { line: 1, kind: 'value', text: '1' },
        { line: 3, kind: 'output', text: 'b' },
        { line: 9, kind: 'value', text: 'outside' },
      ],
      'x\ny\nz'
    );
    expect(answers).toEqual([
      { line: 1, kind: 'value', text: '1' },
      { line: 3, kind: 'output', text: 'b' },
    ]);
  });

  it('keeps the first error on a line and caps text to one line', () => {
    const long = 'x'.repeat(MAX_ANSWER_TEXT_LENGTH + 20);
    const answers = finalizeAnswers(
      [
        { line: 1, kind: 'error', text: 'first\ntrace' },
        { line: 1, kind: 'error', text: 'second' },
        { line: 1, kind: 'value', text: long },
      ],
      'x'
    );
    expect(answers[0]).toEqual({ line: 1, kind: 'error', text: 'first trace' });
    expect(answers[1]!.text).toHaveLength(MAX_ANSWER_TEXT_LENGTH);
    expect(answers[1]!.text.endsWith('…')).toBe(true);
  });
});

describe('jsAnswers', () => {
  it('maps captures, console lines and the error onto cell lines', () => {
    const answers = jsAnswers({
      source: 'a\nb\nc\nd',
      captures: [{ line: 2, text: '[1,2]', type: 'array', size: 2 }],
      stdout: [
        { text: 'ready', line: 1 },
        { text: 'no line', line: null },
      ],
      stderr: [{ text: 'warned', line: 3 }],
      error: { message: 'boom', line: null },
      mapLine: line => (line <= 4 ? line : null),
    });
    expect(answers).toEqual([
      { line: 1, kind: 'output', text: 'ready' },
      { line: 2, kind: 'value', text: '[1,2]', type: 'array', size: 2 },
      { line: 3, kind: 'error', text: 'warned' },
      { line: 4, kind: 'error', text: 'boom' },
    ]);
  });

  it('drops a capture whose line has no counterpart in the cell', () => {
    expect(
      jsAnswers({
        source: 'x',
        captures: [{ line: 7, text: '1', type: 'number' }],
        stdout: [],
        stderr: [],
        mapLine: () => null,
      })
    ).toEqual([]);
  });
});

describe('pythonValueType', () => {
  it.each([
    ['None', { type: 'None' }],
    ['True', { type: 'bool' }],
    ['42', { type: 'int' }],
    ['150.84', { type: 'float' }],
    ['1e-05', { type: 'float' }],
    ["'hi, there'", { type: 'str' }],
    ["b'raw'", { type: 'bytes' }],
    ["[151.2, 'a,b', (1, 2)]", { type: 'list', size: 3 }],
    ['(1,)', { type: 'tuple', size: 1 }],
    ["{'a': 1, 'b': [1, 2]}", { type: 'dict', size: 2 }],
    ['{1, 2, 3}', { type: 'set', size: 3 }],
    ["{'a:b', 'c'}", { type: 'set', size: 2 }],
    ['(1+2j)', { type: 'complex' }],
    ['-3j', { type: 'complex' }],
    ['[]', { type: 'list', size: 0 }],
    ['<object at 0x1>', {}],
  ])('reads %s', (repr, expected) => {
    expect(pythonValueType(repr)).toEqual(expected);
  });
});

describe('pythonAnswers', () => {
  it('answers assignments, prints and the last expression on their lines', () => {
    const result: ExecutionResult = {
      stdout: [{ type: 'log', args: ['ready'], line: 1 }],
      stderr: [],
      executionTime: 1,
      magicResults: [
        { line: 2, value: '[151.2, 146.9]', kind: 'autoLog' },
        { line: 3, value: '149.05', kind: 'autoLog' },
      ],
    };
    expect(pythonAnswers(result, "print('ready')\nt = [151.2, 146.9]\nmean(t)")).toEqual([
      { line: 1, kind: 'output', text: 'ready' },
      { line: 2, kind: 'value', text: '[151.2, 146.9]', type: 'list', size: 2 },
      { line: 3, kind: 'value', text: '149.05', type: 'float' },
    ]);
  });

  it('puts the error on its line, else on the last code line, with the traceback tail', () => {
    const base: ExecutionResult = { stdout: [], stderr: [], executionTime: 1 };
    expect(
      pythonAnswers(
        { ...base, error: { message: 'Traceback\n  File x\nNameError: name y', line: 1 } },
        'y\nz'
      )
    ).toEqual([{ line: 1, kind: 'error', text: 'NameError: name y' }]);
    expect(
      pythonAnswers({ ...base, error: { message: 'ZeroDivisionError' } }, 'a\n1/0\n\n')
    ).toEqual([{ line: 2, kind: 'error', text: 'ZeroDivisionError' }]);
  });
});

describe('sqlAnswerTarget', () => {
  it('names a made table and answers on the last line of the statement', () => {
    const target = sqlAnswerTarget(
      "-- revenue\nCREATE OR REPLACE TABLE main.\"by city\" AS\nSELECT 1;\n"
    );
    expect(target).toEqual({
      firstLine: 2,
      lastLine: 3,
      made: { kind: 'table', name: 'main."by city"', label: 'main.by city' },
      isRead: false,
    });
  });

  it('answers a query on its first line and only reads the last statement', () => {
    expect(sqlAnswerTarget('CREATE VIEW v AS SELECT 1;\nSELECT city,\n  revenue\nFROM v')).toEqual({
      firstLine: 2,
      lastLine: 4,
      isRead: true,
    });
  });

  it('makes nothing from a temporary table, which ends with its connection', () => {
    expect(sqlAnswerTarget('CREATE TEMP TABLE t AS SELECT 1 AS a')).toEqual({ firstLine: 1, lastLine: 1, isRead: false });
  });

  it('ignores a CREATE inside a string or comment', () => {
    expect(sqlAnswerTarget("SELECT 'create table x as' AS note")?.made).toBeUndefined();
  });

  it('returns null for a cell without statements', () => {
    expect(sqlAnswerTarget('-- nothing yet')).toBeNull();
  });
});

describe('sqlErrorLine', () => {
  it('reads DuckDB LINE n when it falls inside the cell', () => {
    expect(sqlErrorLine('Parser Error: syntax error\n\nLINE 2: FRM t', 'SELECT *\nFRM t')).toBe(2);
  });

  it('counts the blank lines above the trimmed query DuckDB ran', () => {
    expect(sqlErrorLine('Parser Error: syntax error\n\nLINE 2: FRM t', '\n\nSELECT *\nFRM t')).toBe(4);
  });

  it('falls back to the last statement', () => {
    expect(sqlErrorLine('Catalog Error: no table', 'SELECT 1;\n\nSELECT * FROM t')).toBe(3);
  });
});
