import { describe, expect, it } from 'vitest';
import { answerGrid, notebookAnswerInput } from '../../../src/renderer/components/Notebook/notebookAnswerView';
import { readAnswer } from '../../../src/renderer/components/Answer/answerObjectModel';
import type { NotebookCellLanguage, NotebookLineAnswerV1 } from '../../../src/shared/notebook';
import type { ScopeValue } from '../../../src/shared/scopeSnapshot';

const num = (repr: string): ScopeValue => ({ kind: 'primitive', type: 'number', repr }) as ScopeValue;
const str = (value: string): ScopeValue => ({ kind: 'primitive', type: 'string', repr: JSON.stringify(value) }) as ScopeValue;

describe('answerGrid', () => {
  const columns = ['city', 'revenue', 'year', 'share'];
  const rows = [
    [str('Medellín'), str('818294.40'), num('2024'), num('28')],
    [str('Bogotá'), str('731121.30'), num('2024'), num('25.1')],
  ];

  it('groups digits in the app language and keeps every fraction digit', () => {
    const grid = answerGrid(columns, rows, 'en');
    expect(grid.cells.map(row => row[1]!.text)).toEqual(['818,294.40', '731,121.30']);
    expect(answerGrid(columns, rows, 'es').cells[0]![1]!.text).toBe('818.294,40');
  });

  it('keeps a decimal written as a whole number and an exponent as written', () => {
    const grid = answerGrid(['value'], [[num('28.0')], [num('1e+21')], [num('12345')]], 'en');
    expect(grid.cells.map(row => row[0]!.text)).toEqual(['28.0', '1e+21', '12,345']);
  });

  it('keeps leading zeros and a negative zero as written', () => {
    const grid = answerGrid(['zip'], [[str('01234')], [str('00.50')], [num('-0')]], 'en');
    expect(grid.cells.map(row => row[0]!.text)).toEqual(['01234', '00.50', '-0']);
  });

  it('leaves years, keys and text as written', () => {
    const grid = answerGrid([...columns, 'user_id'], rows.map(row => [...row, num('104233')]), 'en');
    expect(grid.cells[0]![2]!.text).toBe('2024');
    expect(grid.cells[0]![4]!.text).toBe('104233');
    expect(grid.cells[0]![0]!.text).toBe('Medellín');
  });

  it('scales bars from the raw values, not the formatted text', () => {
    const grid = answerGrid(['city', 'revenue'], rows.map(row => row.slice(0, 2)), 'en');
    expect(grid.barColumn).toBe(1);
    expect(grid.barWidths[0]).toBe(100);
    expect(grid.barWidths[1]).toBeCloseTo((731121.3 / 818294.4) * 100);
  });
});

describe('notebookAnswerInput', () => {
  const read = (answer: NotebookLineAnswerV1, language: NotebookCellLanguage = 'javascript') =>
    readAnswer(notebookAnswerInput(answer, language), { now: 0, locale: 'en' });

  it('reads a value cut to the answer cap as its head, never as a string', () => {
    const cut = `[${Array.from({ length: 80 }, (_, i) => i).join(', ')}`.slice(0, 239) + '…';
    expect(read({ line: 1, kind: 'value', text: cut, type: 'array', size: 80 })).toMatchObject({ tag: 'array', kind: 'array' });
    expect(read({ line: 1, kind: 'value', text: cut, type: 'list', size: 80 }, 'python')).toMatchObject({ tag: 'list', kind: 'array' });
    expect(read({ line: 1, kind: 'value', text: '"abcdef…', type: 'string' })).toMatchObject({ tag: 'string', value: '"abcdef…"' });
    expect(read({ line: 1, kind: 'value', text: "'abcdef…", type: 'str' }, 'python')).toMatchObject({ tag: 'str', value: "'abcdef…'" });
  });

  it('keeps script types that have no literal: bigint, functions, promises, maps and sets', () => {
    expect(read({ line: 1, kind: 'value', text: '12n', type: 'bigint' })).toMatchObject({ tag: 'bigint', value: '12n' });
    expect(read({ line: 1, kind: 'value', text: 'ƒ usd', type: 'function' })).toMatchObject({ tag: 'function', value: 'usd' });
    expect(read({ line: 1, kind: 'value', text: 'Promise', type: 'promise' })).toMatchObject({ tag: 'promise' });
    expect(read({ line: 1, kind: 'value', text: '[["a",1],["b",2]]', type: 'map', size: 2 })).toMatchObject({ tag: 'map·2' });
    expect(read({ line: 1, kind: 'value', text: '[1,2,3]', type: 'set', size: 3 })).toMatchObject({ tag: 'set·3' });
    expect(read({ line: 1, kind: 'value', text: 'NaN', type: 'number' })).toMatchObject({ tone: 'number', value: 'NaN' });
  });

  it('reads printed lines and errors by their role', () => {
    expect(read({ line: 1, kind: 'output', text: 'done' }, 'python')).toMatchObject({ tag: 'stdout', tone: 'plain' });
    expect(read({ line: 1, kind: 'error', text: 'TypeError: x' })).toMatchObject({ tag: 'error', tone: 'error' });
  });

  it('passes the line source so a number can gauge against its threshold', () => {
    const input = notebookAnswerInput({ line: 1, kind: 'value', text: '42', type: 'number' }, 'javascript', 'p95 // < 120');
    expect(input.source).toBe('p95 // < 120');
  });
});
