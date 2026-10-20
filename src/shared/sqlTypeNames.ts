/**
 * Arrow type strings (as `String(arrowType)` prints them) mapped to the
 * DuckDB names the profile and schema browser already use. Unknown shapes
 * come back unchanged so nothing is ever hidden.
 */

const SCALARS: Readonly<Record<string, string>> = {
  Utf8: 'VARCHAR',
  LargeUtf8: 'VARCHAR',
  Int8: 'TINYINT',
  Int16: 'SMALLINT',
  Int32: 'INTEGER',
  Int64: 'BIGINT',
  Uint8: 'UTINYINT',
  Uint16: 'USMALLINT',
  Uint32: 'UINTEGER',
  Uint64: 'UBIGINT',
  Float16: 'FLOAT',
  Float32: 'FLOAT',
  Float64: 'DOUBLE',
  Bool: 'BOOLEAN',
  Binary: 'BLOB',
  LargeBinary: 'BLOB',
  Null: 'NULL',
};

const TIMESTAMP_UNITS: Readonly<Record<string, string>> = {
  SECOND: 'TIMESTAMP_S',
  MILLISECOND: 'TIMESTAMP_MS',
  MICROSECOND: 'TIMESTAMP',
  NANOSECOND: 'TIMESTAMP_NS',
};

/** Splits `a:Int32, b:Struct<{c:Utf8}>` on top-level commas. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '<' || ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '>' || ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function fields(inner: string): Array<[string, string]> | null {
  const body = inner.startsWith('{') && inner.endsWith('}') ? inner.slice(1, -1) : null;
  if (body === null) return null;
  const out: Array<[string, string]> = [];
  for (const part of splitTopLevel(body)) {
    const colon = part.indexOf(':');
    if (colon <= 0) return null;
    out.push([part.slice(0, colon).trim(), arrowTypeToDuckDb(part.slice(colon + 1).trim())]);
  }
  return out;
}

export function arrowTypeToDuckDb(arrowType: string): string {
  const type = arrowType.trim();
  const scalar = SCALARS[type];
  if (scalar) return scalar;

  const decimal = /^Decimal\[(\d+)e([+-]?\d+)\]$/.exec(type);
  if (decimal) return `DECIMAL(${decimal[1]},${Number(decimal[2])})`;
  if (/^Date(32|64)<\w+>$/.test(type)) return 'DATE';
  if (/^Time(32|64)<\w+>$/.test(type)) return 'TIME';
  if (/^Interval<\w+>$/.test(type)) return 'INTERVAL';
  if (/^FixedSizeBinary\[\d+\]$/.test(type)) return 'BLOB';

  const timestamp = /^Timestamp<(\w+)(?:,\s*(.+))?>$/.exec(type);
  if (timestamp) {
    if (timestamp[2]) return 'TIMESTAMP WITH TIME ZONE';
    return TIMESTAMP_UNITS[timestamp[1] ?? ''] ?? type;
  }

  const generic = /^(\w+)<(.*)>$/.exec(type);
  if (!generic) return type;
  const kind = generic[1] ?? '';
  const inner = generic[2] ?? '';
  if (kind === 'List' || kind === 'LargeList' || kind === 'FixedSizeList') {
    return `${arrowTypeToDuckDb(inner)}[]`;
  }
  if (kind === 'Dictionary') return 'ENUM';
  if (kind === 'Struct') {
    const parsed = fields(inner);
    return parsed ? `STRUCT(${parsed.map(([name, t]) => `${name} ${t}`).join(', ')})` : type;
  }
  if (kind === 'Map') {
    const parsed = fields(inner);
    const [key, value] = parsed ?? [];
    return key && value && parsed?.length === 2 ? `MAP(${key[1]}, ${value[1]})` : type;
  }
  return type;
}
