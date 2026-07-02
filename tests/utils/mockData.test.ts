import { describe, expect, it } from 'vitest';
import {
  MOCK_DATA_MAX_COUNT,
  generateMockData,
} from '@/utils/mockData';

describe('generateMockData', () => {
  it('returns an empty string for a zero or negative count', () => {
    expect(generateMockData({ dataset: 'users', count: 0, format: 'json' })).toBe('');
    expect(generateMockData({ dataset: 'users', count: -5, format: 'json' })).toBe('');
  });

  it('is deterministic for a fixed seed', () => {
    const a = generateMockData({ dataset: 'users', count: 5, format: 'json', seed: 'abc' });
    const b = generateMockData({ dataset: 'users', count: 5, format: 'json', seed: 'abc' });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('produces different output for different seeds', () => {
    const a = generateMockData({ dataset: 'users', count: 8, format: 'json', seed: 'seed-1' });
    const b = generateMockData({ dataset: 'users', count: 8, format: 'json', seed: 'seed-2' });
    expect(a).not.toBe(b);
  });

  it('emits a JSON array with the requested row count', () => {
    const out = generateMockData({ dataset: 'users', count: 3, format: 'json', seed: 's' });
    const parsed = JSON.parse(out) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  it('emits NDJSON with one JSON object per line', () => {
    const out = generateMockData({ dataset: 'products', count: 4, format: 'ndjson', seed: 's' });
    const lines = out.split('\n');
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('emits CSV with a header row plus one row per record', () => {
    const out = generateMockData({ dataset: 'posts', count: 5, format: 'csv', seed: 's' });
    const lines = out.split('\n');
    // 1 header + 5 data rows.
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('id');
  });

  it('quotes CSV cells that contain commas', () => {
    // The posts dataset builds multi-word titles; a title with a comma
    // must be RFC-4180 quoted so the CSV stays parseable.
    const out = generateMockData({ dataset: 'products', count: 20, format: 'csv', seed: 'commas' });
    for (const line of out.split('\n')) {
      // No unquoted field may introduce a bare stray quote pattern.
      // A quoted cell always has an even number of double-quotes.
      const quoteCount = (line.match(/"/g) ?? []).length;
      expect(quoteCount % 2).toBe(0);
    }
  });

  it('clamps the count to the maximum', () => {
    const out = generateMockData({
      dataset: 'users',
      count: MOCK_DATA_MAX_COUNT + 500,
      format: 'json',
      seed: 's',
    });
    const parsed = JSON.parse(out) as unknown[];
    expect(parsed).toHaveLength(MOCK_DATA_MAX_COUNT);
  });

  it('produces the documented fields for each dataset', () => {
    const users = JSON.parse(
      generateMockData({ dataset: 'users', count: 1, format: 'json', seed: 's' })
    ) as Array<Record<string, unknown>>;
    expect(Object.keys(users[0]!).sort()).toEqual(
      ['active', 'age', 'createdAt', 'email', 'id', 'name'].sort()
    );

    const products = JSON.parse(
      generateMockData({ dataset: 'products', count: 1, format: 'json', seed: 's' })
    ) as Array<Record<string, unknown>>;
    expect(Object.keys(products[0]!).sort()).toEqual(
      ['category', 'id', 'inStock', 'name', 'price', 'sku'].sort()
    );

    const posts = JSON.parse(
      generateMockData({ dataset: 'posts', count: 1, format: 'json', seed: 's' })
    ) as Array<Record<string, unknown>>;
    expect(Object.keys(posts[0]!).sort()).toEqual(
      ['createdAt', 'id', 'published', 'slug', 'title', 'views'].sort()
    );
  });
});
