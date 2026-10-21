import { describe, expect, it } from 'vitest';
import {
  DISTINCT_CAP,
  betweenPredicate,
  columnStats,
  equalsPredicate,
} from '../../../src/renderer/components/SqlWorkspace/sqlColumnStats';

const columns = [
  { name: 'channel', type: 'Utf8' },
  { name: 'releases', type: 'Int64' },
  { name: 'latest', type: 'Date32<DAY>' },
  { name: 'odd name', type: 'Utf8' },
];
const rows = [
  { channel: 'stable', releases: '8', latest: '2026-10-14', 'odd name': "it's" },
  { channel: 'beta', releases: '3', latest: '2026-10-16', 'odd name': 'x' },
  { channel: null, releases: '1', latest: null, 'odd name': 'x' },
  { channel: 'nightly', releases: '31', latest: '2026-10-17', 'odd name': 'x' },
  { channel: 'stable', releases: '2', latest: '2026-09-30', 'odd name': 'x' },
];

describe('columnStats', () => {
  const [channel, releases, latest] = columnStats(columns, rows);

  it('counts nulls and distinct values, and ranks the top values of a text column', () => {
    expect(channel).toMatchObject({ kind: 'text', nullShare: 0.2, distinct: 3, range: { low: 'beta', high: 'stable' } });
    expect(channel!.top[0]).toEqual({ value: 'stable', count: 2 });
    expect(channel!.bins).toEqual([]);
  });

  it('bins numbers by value even when DuckDB sends them as strings', () => {
    expect(releases).toMatchObject({ kind: 'number', nullShare: 0, distinct: 5, range: { low: '1', high: '31' } });
    expect(releases!.bins).toHaveLength(8);
    expect(releases!.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
    expect(releases!.bins[7]!.count).toBe(1);
  });

  it('bins dates by time', () => {
    expect(latest).toMatchObject({ kind: 'date', range: { low: '2026-09-30', high: '2026-10-17' } });
    expect(latest!.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(4);
  });

  it('handles an empty result', () => {
    expect(columnStats(columns, [])[0]).toMatchObject({ nullShare: 0, distinct: 0, range: null, bins: [] });
  });
});

describe('wide and long results', () => {
  it('stops tracking new values past the distinct cap and reads only the first rows of a wide result', () => {
    const wide = Array.from({ length: 200 }, (_, i) => ({ name: `c${i}`, type: 'Utf8' }));
    const many = Array.from({ length: 12_000 }, (_, i) => {
      const row: Record<string, unknown> = { c0: `v${i}` };
      return row;
    });
    const [first] = columnStats(wide, many);
    // 200 columns leave room for 5,000 rows inside the cell budget.
    expect(first).toMatchObject({ distinct: 5_000, distinctCapped: false });
    const [narrow] = columnStats([{ name: 'c0', type: 'Utf8' }], many);
    expect(narrow).toMatchObject({ distinct: DISTINCT_CAP, distinctCapped: true });
  });
});

describe('rail predicates', () => {
  const [channel, releases, latest, odd] = columnStats(columns, rows);

  it('quotes text values and odd names, and leaves numbers bare', () => {
    expect(equalsPredicate(channel!, 'stable')).toBe("channel = 'stable'");
    expect(equalsPredicate(odd!, "it's")).toBe(`"odd name" = 'it''s'`);
    expect(equalsPredicate(releases!, '8')).toBe('releases = 8');
  });

  it('builds BETWEEN over one bin or a run of bins', () => {
    const bins = releases!.bins;
    expect(betweenPredicate(releases!, bins[0]!, bins[0]!)).toBe('releases BETWEEN 1 AND 5');
    expect(betweenPredicate(releases!, bins[7]!, bins[0]!)).toBe('releases BETWEEN 1 AND 31');
    expect(betweenPredicate(latest!, latest!.bins[0]!, latest!.bins[7]!)).toBe("latest BETWEEN '2026-09-30' AND '2026-10-17'");
  });
});
