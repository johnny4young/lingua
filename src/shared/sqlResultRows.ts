/**
 * The preview window both Local engines share: DuckDB-WASM's Arrow rows and the
 * native engine's converted rows pass through the same caps and cell formatting,
 * so switching engines never changes what the grid shows.
 */

import { MAX_RESULT_PREVIEW_BYTES, MAX_RESULT_ROWS, utf8ByteLength, type SqlColumnMetadata } from './sqlWorkspace';

export interface ResultField {
  name: string;
  type: { toString(): string };
}

/**
 * Collects preview rows under the row and byte caps. `add` returns false once
 * the window is full, so a streaming reader knows when to stop.
 */
export function createRowAccumulator(
  fields: ReadonlyArray<ResultField>,
  caps: { maxRows: number; maxBytes: number } = { maxRows: MAX_RESULT_ROWS, maxBytes: MAX_RESULT_PREVIEW_BYTES }
) {
  const columns: SqlColumnMetadata[] = fields.map((field) => ({
    name: field.name,
    type: stringifyArrowType(field.type),
  }));
  const temporal = columns.flatMap(column => {
    const format = temporalFormatter(column.type);
    return format ? [[column.name, format] as const] : [];
  });
  const decimals = columns.flatMap(column => {
    const scale = decimalScale(column.type);
    return scale === null ? [] : [[column.name, scale] as const];
  });
  const rows: Array<Record<string, unknown>> = [];
  let approxBytes = 0;
  let full = false;
  return {
    columns,
    rows,
    /** Adds rows until the window fills; returns how many it took. */
    add(batch: Array<Record<string, unknown>>): number {
      let taken = 0;
      for (const raw of batch) {
        if (full) break;
        if (rows.length >= caps.maxRows) {
          full = true;
          break;
        }
        taken += 1;
        if (raw === undefined || raw === null) continue;
        const safeRow = sanitiseRowForJson(raw);
        for (const [name, scale] of decimals) {
          const text = formatArrowDecimal(raw[name], scale);
          if (text !== null) safeRow[name] = text;
        }
        for (const [name, format] of temporal) {
          const cell = safeRow[name];
          if (typeof cell === 'number') safeRow[name] = format(cell);
        }
        const rowBytes = utf8ByteLength(JSON.stringify(safeRow));
        if (approxBytes + rowBytes > caps.maxBytes) {
          full = true;
          taken -= 1;
          break;
        }
        approxBytes += rowBytes;
        rows.push(safeRow);
      }
      if (rows.length >= caps.maxRows) full = true;
      return taken;
    },
    isFull: () => full,
    /** Rows taken so far, measured as UTF-8 JSON. */
    bytes: () => approxBytes,
  };
}

/**
 * Coerce DuckDB / Arrow cell values into JSON-friendly shapes.
 *
 *   - `BigInt` → string (JSON cannot encode BigInts; preserving
 *     precision matters for `BIGINT` columns).
 *   - `Date` → ISO string.
 *   - `Uint8Array` / Buffer → base64 string (rare in result sets but
 *     defensive).
 *   - Nested objects + arrays are recursed.
 *   - Numbers + booleans + strings + null pass through; `Infinity`,
 *     `-Infinity` and `NaN` become that text, as the connection host does,
 *     because JSON cannot hold them.
 *   - Symbols + functions → `null` (defensive — DuckDB never returns
 *     these, but Arrow row objects can carry prototype chains).
 */
function sanitiseRowForJson(
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key] = sanitiseValueForJson(row[key]);
  }
  return out;
}

function sanitiseValueForJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (valueType === 'bigint') return (value as bigint).toString();
  if (valueType === 'symbol' || valueType === 'function') return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    // Best-effort: convert to base64. Avoids dragging in `buffer`.
    let binary = '';
    for (let i = 0; i < value.byteLength; i += 1) {
      binary += String.fromCharCode(value[i]!);
    }
    if (typeof btoa === 'function') return btoa(binary);
    return binary;
  }
  if (Array.isArray(value)) return value.map(sanitiseValueForJson);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>, sanitiseValueForJson);
  if (valueType === 'object') {
    const obj = value as Record<string, unknown>;
    // Arrow LIST and STRUCT cells are Vector / row objects; their toJSON is the plain value.
    if (typeof obj.toJSON === 'function') return sanitiseValueForJson((obj.toJSON as () => unknown)());
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = sanitiseValueForJson(obj[key]);
    }
    return out;
  }
  return null;
}

/** Scale of an Arrow `Decimal[precision e±scale]` type, or null for other types. */
function decimalScale(type: string): number | null {
  const match = /^Decimal\[\d+e\+?(-?\d+)\]/u.exec(type);
  return match ? Number(match[1]) : null;
}

/**
 * Arrow Decimal cells (DuckDB SUM over integers, HUGEINT, DECIMAL) arrive as
 * little-endian 32-bit words of a two's-complement integer; render them as
 * exact decimal text instead of a word array.
 */
function formatArrowDecimal(value: unknown, scale: number): string | null {
  if (value === null || value === undefined || typeof value !== 'object') return null;
  const words = Array.from(value as ArrayLike<number>);
  if (words.length === 0 || words.some(word => typeof word !== 'number')) return null;
  let unscaled = 0n;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    unscaled = (unscaled << 32n) | BigInt(words[index]! >>> 0);
  }
  const bits = BigInt(words.length * 32);
  if (unscaled >> (bits - 1n)) unscaled -= 1n << bits;
  return formatDecimalText(unscaled, scale);
}

/** A DECIMAL's unscaled integer as exact text with `scale` digits after the point. */
export function formatDecimalText(unscaled: bigint, scale: number): string {
  const negative = unscaled < 0n;
  let digits = (negative ? -unscaled : unscaled).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return negative ? `-${digits}` : digits;
}

/**
 * Arrow hands DATE and TIMESTAMP cells back as epoch milliseconds; render
 * them as ISO text so the grid and import preview show calendar values.
 */
export function temporalFormatter(type: string): ((epochMs: number) => string | number) | null {
  const iso = (epochMs: number) => {
    const date = new Date(epochMs);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  if (/^Date(32)?<DAY>/u.test(type)) return epochMs => iso(epochMs)?.slice(0, 10) ?? epochMs;
  if (/^Date(64)?</u.test(type)) return epochMs => iso(epochMs) ?? epochMs;
  if (/^Timestamp</u.test(type)) {
    // Without a zone the value is a wall-clock time, so drop the UTC marker.
    const zoned = type.includes(',');
    return epochMs => {
      const text = iso(epochMs);
      if (!text) return epochMs;
      return zoned ? text : text.replace('Z', '');
    };
  }
  return null;
}

function stringifyArrowType(type: { toString(): string }): string {
  try {
    return String(type);
  } catch {
    return 'unknown';
  }
}
