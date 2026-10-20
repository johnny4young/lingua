import { describe, expect, it } from 'vitest';
import { buildSampleTable } from '../../src/shared/sqlSampleTable';

describe('sample table', () => {
  it('creates cities with city, orders and revenue, and a ready SELECT', () => {
    const sample = buildSampleTable([]);
    expect(sample.tableName).toBe('cities');
    expect(sample.createSql).toMatch(
      /^CREATE TABLE cities \(city VARCHAR, orders INTEGER, revenue DECIMAL\(10, 2\)\);/
    );
    expect(sample.createSql).toContain("('Bogotá', 412, 18240.50)");
    expect(sample.selectSql).toBe(
      'SELECT city, orders, revenue\nFROM cities\nORDER BY revenue DESC;'
    );
  });

  it('never replaces an existing table', () => {
    const sample = buildSampleTable(['Cities', 'cities_2']);
    expect(sample.tableName).toBe('cities_3');
    expect(sample.createSql).toContain('CREATE TABLE cities_3 ');
    expect(sample.selectSql).toContain('FROM cities_3');
  });
});
