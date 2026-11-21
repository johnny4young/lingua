import { describe, expect, it } from 'vitest';
import {
  barShare,
  formatSummary,
  isIdentifierColumn,
  resultInstruments,
} from '../../../src/renderer/components/SqlWorkspace/sqlColumnInstruments';
import { DELETED } from '../../../src/renderer/components/SqlWorkspace/sqlRowEditModel';

const numeric = (...names: string[]) => names.map((name) => ({ name, type: 'Float64' }));

describe('resultInstruments', () => {
  it('scales each numeric column against its own largest value and sums it', () => {
    const rows = [
      { city: 'Cali', orders: 10, revenue: '120.50' },
      { city: 'Lima', orders: 40, revenue: '80.25' },
    ];
    const result = resultInstruments([{ name: 'city', type: 'Utf8' }, ...numeric('orders', 'revenue')], rows, new Set(), 1_000);
    expect([...result.scales]).toEqual([
      ['orders', 40],
      ['revenue', 120.5],
    ]);
    expect(result.summaries.get('orders')).toEqual({ kind: 'sum', value: 50, digits: 0 });
    expect(result.summaries.get('revenue')).toEqual({ kind: 'sum', value: 200.75, digits: 2 });
    expect(result.summaries.has('city')).toBe(false);
    expect(result).toMatchObject({ rowCount: 2, skipped: 0, labelColumn: 'city' });
  });

  it('averages ratios by name and 0–1 fractions, and leaves the fraction to its own bar', () => {
    const rows = [
      { avg_ticket: 10, conversionRate: 2, share: 0.25 },
      { avg_ticket: 20, conversionRate: 4, share: 0.75 },
    ];
    const result = resultInstruments(numeric('avg_ticket', 'conversionRate', 'share'), rows, new Set(), 1_000);
    expect(result.summaries.get('avg_ticket')).toEqual({ kind: 'avg', value: 15, digits: 2 });
    expect(result.summaries.get('conversionRate')?.kind).toBe('avg');
    expect(result.summaries.get('share')).toEqual({ kind: 'avg', value: 0.5, digits: 2 });
    expect(result.scales.has('share')).toBe(false);
  });

  it('draws no bar for keys, linked columns, negatives or a single value, and never sums a key', () => {
    const rows = [
      { id: 1, user_id: 7, delta: -3, flat: 5, linked: 1 },
      { id: 2, user_id: 9, delta: 4, flat: 5, linked: 3 },
    ];
    const result = resultInstruments(numeric('id', 'user_id', 'delta', 'flat', 'linked'), rows, new Set(['linked']), 1_000);
    expect(result.scales.size).toBe(0);
    expect(result.summaries.has('id')).toBe(false);
    expect(result.summaries.has('user_id')).toBe(false);
    expect(result.summaries.get('delta')?.value).toBe(1);
  });

  it('skips nulls, text in numeric columns and staged deletions', () => {
    const rows = [{ n: 2 }, { n: null }, { n: 'n/a' }, Object.assign({ n: 100 }, { [DELETED]: true }), { n: '3' }];
    const result = resultInstruments(numeric('n'), rows, new Set(), 1_000);
    expect(result.summaries.get('n')?.value).toBe(5);
    expect(result.scales.get('n')).toBe(3);
    expect(result.rowCount).toBe(4);
  });

  it('marks fraction columns: JS numbers from 0 to 1 with at least one fraction', () => {
    const columns = [...numeric('share', 'flag', 'big', 'decimal'), { name: 'name', type: 'Utf8' }];
    const rows = [
      { share: 0.25, flag: 1, big: 0.5, decimal: '0.5', name: '0.5' },
      { share: null, flag: 0, big: 7, decimal: '0.1', name: '0.1' },
      { share: 1, flag: 1, big: 0.1, decimal: '0.2', name: 'x' },
    ];
    expect([...resultInstruments(columns, rows, new Set(), 1_000).fractions]).toEqual(['share']);
    expect(resultInstruments(columns, [], new Set(), 1_000).fractions.size).toBe(0);
    // A DECIMAL string column keeps its scale bar instead.
    expect(resultInstruments(columns, rows, new Set(), 1_000).scales.has('decimal')).toBe(true);
  });

  it('puts the Σ label on the first column when every column has a sum', () => {
    expect(resultInstruments(numeric('a', 'b'), [{ a: 1, b: 2 }], new Set(), 1_000).labelColumn).toBe('a');
  });

  it('stops at the row limit and counts the live rows it left out', () => {
    const rows = Array.from({ length: 5 }, (_, n) => ({ n }));
    const result = resultInstruments(numeric('n'), rows, new Set(), 3);
    expect(result).toMatchObject({ rowCount: 3, skipped: 2 });
    expect(result.summaries.get('n')?.value).toBe(3);
  });
});

describe('column helpers', () => {
  it('knows a key by its last word', () => {
    expect(['id', 'user_id', 'userId', 'Order ID'].every(isIdentifierColumn)).toBe(true);
    expect(['idle', 'paid', 'width'].some(isIdentifierColumn)).toBe(false);
  });

  it('turns a value into its share of the column maximum', () => {
    expect(barShare(25, 100)).toBe(0.25);
    expect(barShare('50', 100)).toBe(0.5);
    expect(barShare(null, 100)).toBeNull();
    expect(barShare(-1, 100)).toBeNull();
    expect(barShare(5, undefined)).toBeNull();
  });

  it('formats a summary in the app locale at the column precision', () => {
    expect(formatSummary({ kind: 'sum', value: 2927214.7, digits: 2 }, 'en')).toBe('2,927,214.70');
    expect(formatSummary({ kind: 'avg', value: 146.364, digits: 2 }, 'es')).toBe('146,36');
  });
});
