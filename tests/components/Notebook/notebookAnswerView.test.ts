import { describe, expect, it } from 'vitest';
import { answerGrid } from '../../../src/renderer/components/Notebook/notebookAnswerView';
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
