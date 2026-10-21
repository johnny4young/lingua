import { strToU8, zipSync } from 'fflate';
import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';

/** A sheet holds 1,048,576 rows; the header takes one. */
export const XLSX_MAX_ROWS = 1_048_575;
const MAX_CELL_CHARS = 32_767;
// Excel keeps 15 significant digits; longer numbers stay text so nothing is rounded.
const MAX_DIGITS = 15;

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const escapeXml = (text: string) =>
  text
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function columnLetter(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));
  } catch {
    return String(value);
  }
}

const fitsNumber = (text: string) =>
  NUMBER.test(text) &&
  Number.isFinite(Number(text)) &&
  text.replace(/[eE].*$/, '').replace(/[-.]/g, '').replace(/^0+(?=\d)/, '').length <= MAX_DIGITS;

function cellXml(ref: string, value: unknown, numeric: boolean): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = asText(value);
  const isNumber =
    (typeof value === 'number' && Number.isFinite(value)) ||
    ((typeof value === 'bigint' || (numeric && typeof value === 'string')) && fitsNumber(text));
  if (isNumber) return `<c r="${ref}"><v>${text}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text.slice(0, MAX_CELL_CHARS))}</t></is></c>`;
}

function sheetXml(columns: ReadonlyArray<SqlColumnMetadata>, rows: ReadonlyArray<Record<string, unknown>>): string {
  const letters = columns.map((_column, index) => columnLetter(index));
  const numeric = columns.map((column) => isNumericSqlType(arrowTypeToDuckDb(column.type)));
  const header = columns
    .map((column, index) => `<c r="${letters[index]}1" t="inlineStr" s="1"><is><t>${escapeXml(column.name)}</t></is></c>`)
    .join('');
  const body = rows.slice(0, XLSX_MAX_ROWS).map((row, rowIndex) => {
    const line = rowIndex + 2;
    const cells = columns.map((column, index) => cellXml(`${letters[index]}${line}`, row[column.name], numeric[index]!));
    return `<row r="${line}">${cells.join('')}</row>`;
  });
  return (
    `${XML_HEAD}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0">` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetData><row r="1">${header}</row>${body.join('')}</sheetData></worksheet>`
  );
}

const STYLES =
  `${XML_HEAD}<styleSheet xmlns="${NS}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';

/** One-sheet workbook with a bold, frozen header row. Rows past the sheet limit are left out. */
export function rowsToXlsx(
  columns: ReadonlyArray<SqlColumnMetadata>,
  rows: ReadonlyArray<Record<string, unknown>>
): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `${XML_HEAD}<Relationships xmlns="${PKG_NS}">` +
          `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      ),
      'xl/workbook.xml': strToU8(
        `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets><sheet name="Result" sheetId="1" r:id="rId1"/></sheets></workbook>`
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        `${XML_HEAD}<Relationships xmlns="${PKG_NS}">` +
          `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`
      ),
      'xl/styles.xml': strToU8(STYLES),
      'xl/worksheets/sheet1.xml': strToU8(sheetXml(columns, rows)),
    },
    { level: 6 }
  );
}
