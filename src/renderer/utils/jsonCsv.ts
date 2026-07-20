/**
 * internal — JSON ↔ CSV converter helper.
 *
 * Pure, offline, renderer-side. Implements RFC 4180 CSV with a
 * configurable delimiter (`,` default, `\t`, `;`, `|`) and an
 * optional header row.
 *
 * Forward direction (JSON → CSV):
 * - Input must parse as a JSON array of flat objects (each object's
 *   values must be strings, numbers, booleans, or null). Nested
 *   objects/arrays are rejected with a tagged error rather than
 *   silently flattened, since flattening loses information without
 *   a clear policy.
 * - Header row is the union of keys across all objects, in
 *   first-seen order. The `includeHeader` option controls emission.
 *
 * Reverse direction (CSV → JSON):
 * - State-machine parser that handles quoted fields containing
 *   commas, newlines, and double-quote escaping (`""`).
 * - When `includeHeader` is true, the first row becomes the keys of
 *   each emitted object; otherwise rows emit as positional arrays.
 * - Output is JSON-stringified at 2-space indent.
 */

export type JsonCsvDelimiter = ',' | '\t' | ';' | '|';

export const JSON_CSV_DELIMITERS: readonly JsonCsvDelimiter[] = [',', '\t', ';', '|'];

export interface JsonCsvOptions {
  readonly delimiter: JsonCsvDelimiter;
  readonly includeHeader: boolean;
}

export type JsonToCsvResult =
  | { ok: true; output: string; rowCount: number; columnCount: number }
  | { ok: false; errorKey: string; message?: string };

export type CsvToJsonResult =
  | { ok: true; output: string; rowCount: number; columnCount: number }
  | { ok: false; errorKey: string; message?: string };

/** Hard cap on input byte length (UTF-8) before we refuse to convert. */
export const JSON_CSV_MAX_BYTES = 200 * 1024; // 200 KB
export const JSON_CSV_MAX_KB = Math.round(JSON_CSV_MAX_BYTES / 1024);

export function convertJsonToCsv(
  json: string,
  options: JsonCsvOptions
): JsonToCsvResult {
  const trimmed = json.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.jsonCsv.error.empty' };
  }

  if (new TextEncoder().encode(trimmed).byteLength > JSON_CSV_MAX_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.jsonCsv.error.tooLarge' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.invalidJson',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, errorKey: 'utilities.tool.jsonCsv.error.notArray' };
  }

  // Collect the union of keys in first-seen order.
  const headers: string[] = [];
  const headerIndex = new Map<string, number>();
  const rowsAsObjects: Array<Record<string, unknown>> = [];

  for (let rowIndex = 0; rowIndex < parsed.length; rowIndex += 1) {
    const row = parsed[rowIndex];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return {
        ok: false,
        errorKey: 'utilities.tool.jsonCsv.error.notFlatObjects',
        message: `Row ${rowIndex} is not a flat object.`,
      };
    }
    const obj = row as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (
        value !== null &&
        typeof value === 'object'
      ) {
        return {
          ok: false,
          errorKey: 'utilities.tool.jsonCsv.error.notFlatObjects',
          message: `Row ${rowIndex} key "${key}" is a nested object or array.`,
        };
      }
      if (!headerIndex.has(key)) {
        headerIndex.set(key, headers.length);
        headers.push(key);
      }
    }
    rowsAsObjects.push(obj);
  }

  const lines: string[] = [];
  if (options.includeHeader && headers.length > 0) {
    lines.push(headers.map((h) => csvEscapeField(h, options.delimiter)).join(options.delimiter));
  }
  for (const obj of rowsAsObjects) {
    const cells: string[] = [];
    for (const header of headers) {
      const value = obj[header];
      cells.push(csvEscapeField(formatCellValue(value), options.delimiter));
    }
    lines.push(cells.join(options.delimiter));
  }

  return {
    ok: true,
    output: lines.join('\n'),
    rowCount: rowsAsObjects.length,
    columnCount: headers.length,
  };
}

export function convertCsvToJson(
  csv: string,
  options: JsonCsvOptions
): CsvToJsonResult {
  if (csv.trim().length === 0) {
    return { ok: false, errorKey: 'utilities.tool.jsonCsv.error.empty' };
  }

  if (new TextEncoder().encode(csv).byteLength > JSON_CSV_MAX_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.jsonCsv.error.tooLarge' };
  }

  let rows: string[][];
  try {
    rows = parseCsvRows(csv, options.delimiter);
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.jsonCsv.error.invalidCsv',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (rows.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.jsonCsv.error.empty' };
  }

  let dataRows: string[][];
  let headers: string[] | null = null;
  if (options.includeHeader) {
    const [first, ...rest] = rows;
    if (!first || first.length === 0) {
      return { ok: false, errorKey: 'utilities.tool.jsonCsv.error.empty' };
    }
    const headerError = validateHeaderRow(first);
    if (headerError) {
      return {
        ok: false,
        errorKey: 'utilities.tool.jsonCsv.error.invalidCsv',
        message: headerError,
      };
    }
    headers = first;
    dataRows = rest;
  } else {
    dataRows = rows;
  }

  let payload: unknown;
  if (headers !== null) {
    payload = dataRows.map((row) => {
      const obj: Record<string, string> = {};
      for (let index = 0; index < headers!.length; index += 1) {
        const key = headers![index] ?? `column_${index + 1}`;
        obj[key] = row[index] ?? '';
      }
      return obj;
    });
  } else {
    payload = dataRows;
  }

  const columnCount = headers !== null
    ? headers.length
    : dataRows.reduce((max, row) => Math.max(max, row.length), 0);

  return {
    ok: true,
    output: JSON.stringify(payload, null, 2),
    rowCount: dataRows.length,
    columnCount,
  };
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function csvEscapeField(value: string, delimiter: string): string {
  // RFC 4180: quote when the field contains the delimiter, double-quote,
  // CR, or LF. Quotes inside the field are escaped by doubling.
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCsvRows(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldQuoted = false;
  let afterClosingQuote = false;
  let i = 0;
  const len = input.length;

  const flushField = () => {
    row.push(field);
    field = '';
    fieldQuoted = false;
    afterClosingQuote = false;
  };

  const flushRow = () => {
    flushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const char = input[i] ?? '';
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          // Escaped quote inside a quoted field.
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        afterClosingQuote = true;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (afterClosingQuote) {
      if (char === delimiter) {
        flushField();
        i += 1;
        continue;
      }
      if (char === '\r') {
        if (input[i + 1] === '\n') i += 1;
        flushRow();
        i += 1;
        continue;
      }
      if (char === '\n') {
        flushRow();
        i += 1;
        continue;
      }
      throw new Error('Unexpected character after closing quote in CSV input');
    }

    if (char === '"') {
      if (field.length > 0 || fieldQuoted) {
        throw new Error('Unexpected double quote in unquoted CSV field');
      }
      inQuotes = true;
      fieldQuoted = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      flushField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      // Treat \r\n and bare \r the same as \n: end of row.
      if (input[i + 1] === '\n') i += 1;
      flushRow();
      i += 1;
      continue;
    }
    if (char === '\n') {
      flushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) {
    throw new Error('Unclosed double quote in CSV input');
  }

  // Flush final field/row.
  if (field.length > 0 || row.length > 0 || fieldQuoted || afterClosingQuote) {
    flushField();
    rows.push(row);
  }

  // Drop a trailing empty row that comes from input ending in \n.
  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && lastRow.length === 1 && lastRow[0] === '') {
      rows.pop();
    }
  }

  return rows;
}

function validateHeaderRow(headers: readonly string[]): string | null {
  const seen = new Set<string>();
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index] ?? '';
    if (header.length === 0) {
      return `Header ${index + 1} is empty.`;
    }
    if (seen.has(header)) {
      return `Header "${header}" is duplicated.`;
    }
    seen.add(header);
  }
  return null;
}
