import { dedupeTableName } from './sqlWorkspace';

/** Rows of the sample table: city, orders, revenue. */
const SAMPLE_ROWS: ReadonlyArray<readonly [string, number, string]> = [
  ['Bogotá', 412, '18240.50'],
  ['Lima', 365, '15980.00'],
  ['Madrid', 298, '21430.75'],
  ['Mexico City', 521, '24310.20'],
  ['Santiago', 187, '9120.40'],
  ['São Paulo', 603, '28770.90'],
];

export interface SqlSampleTable {
  tableName: string;
  /** Creates the table; safe to run once per name. */
  createSql: string;
  /** The ready-to-run query the new tab opens with. */
  selectSql: string;
}

/** The in-memory `cities` sample, renamed `cities_2`… when the name is taken. */
export function buildSampleTable(existingTableNames: Iterable<string>): SqlSampleTable {
  const tableName = dedupeTableName('cities', existingTableNames);
  const values = SAMPLE_ROWS.map(
    ([city, orders, revenue]) => `('${city.replace(/'/g, "''")}', ${orders}, ${revenue})`
  ).join(',\n  ');
  return {
    tableName,
    createSql:
      `CREATE TABLE ${tableName} (city VARCHAR, orders INTEGER, revenue DECIMAL(10, 2));\n` +
      `INSERT INTO ${tableName} VALUES\n  ${values};`,
    selectSql: `SELECT city, orders, revenue\nFROM ${tableName}\nORDER BY revenue DESC;`,
  };
}
