import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { columnLetter, rowsToXlsx } from '../../../src/renderer/components/SqlWorkspace/sqlXlsx';

const columns = [
  { name: 'id', type: 'Int64' },
  { name: 'total', type: 'Decimal[12e+2]' },
  { name: 'note', type: 'Utf8' },
  { name: 'ok', type: 'Bool' },
];

function sheet(rows: Array<Record<string, unknown>>) {
  const files = unzipSync(rowsToXlsx(columns, rows));
  return { files, xml: strFromU8(files['xl/worksheets/sheet1.xml']!) };
}

describe('rowsToXlsx', () => {
  it('writes a one-sheet workbook with the parts Excel needs', () => {
    const { files } = sheet([]);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('writes a bold header, numbers as numbers, text escaped, booleans and blanks for NULL', () => {
    const { xml } = sheet([
      { id: '9007199254740993', total: '125000.50', note: 'a < b & "c"\u0007', ok: true },
      { id: 2n, total: null, note: null, ok: false },
    ]);
    expect(xml).toContain('<c r="A1" t="inlineStr" s="1"><is><t>id</t></is></c>');
    // Past 15 significant digits a number stays text so Excel does not round it.
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">9007199254740993</t></is></c>');
    expect(xml).toContain('<c r="B2"><v>125000.50</v></c>');
    expect(xml).toContain('<t xml:space="preserve">a &lt; b &amp; &quot;c&quot;</t>');
    expect(xml).toContain('<c r="D2" t="b"><v>1</v></c>');
    expect(xml).toContain('<row r="3"><c r="A3"><v>2</v></c><c r="D3" t="b"><v>0</v></c></row>');
    expect(xml).toContain('state="frozen"');
  });

  it('names columns past Z the way a sheet does', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});
