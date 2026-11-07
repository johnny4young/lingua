/**
 * Native DuckDB values as the renderer's grid takes them. Column types carry the
 * Arrow names DuckDB-WASM reports and cells match what its Arrow rows become
 * after the shared preview window, so a result reads the same on either engine.
 * Where WASM's Arrow mapping loses data (INTERVAL, TIMETZ, BIT, BIGNUM,
 * UHUGEINT, DECIMAL inside a nested value, infinite timestamps) the native engine
 * keeps DuckDB's own value instead; the parity suite pins each of these.
 */

import type { DuckDBType, DuckDBValue } from '@duckdb/node-api';
import { formatDecimalText, temporalFormatter } from '../../shared/sqlResultRows';
import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';

// DuckDB's C API type ids, stable across releases; read here so this module never loads the binding.
const T = {
  BOOLEAN: 1,
  TINYINT: 2,
  SMALLINT: 3,
  INTEGER: 4,
  BIGINT: 5,
  UTINYINT: 6,
  USMALLINT: 7,
  UINTEGER: 8,
  UBIGINT: 9,
  FLOAT: 10,
  DOUBLE: 11,
  TIMESTAMP: 12,
  DATE: 13,
  TIME: 14,
  INTERVAL: 15,
  HUGEINT: 16,
  VARCHAR: 17,
  BLOB: 18,
  DECIMAL: 19,
  TIMESTAMP_S: 20,
  TIMESTAMP_MS: 21,
  TIMESTAMP_NS: 22,
  ENUM: 23,
  LIST: 24,
  STRUCT: 25,
  MAP: 26,
  UUID: 27,
  UNION: 28,
  BIT: 29,
  TIME_TZ: 30,
  TIMESTAMP_TZ: 31,
  UHUGEINT: 32,
  ARRAY: 33,
  BIGNUM: 35,
  SQLNULL: 36,
  TIME_NS: 39,
} as const;

/** The zone DuckDB-WASM's Arrow schema names for TIMESTAMPTZ, whatever the session's TimeZone. */
const ARROW_TIME_ZONE = 'UTC';

type Typed = DuckDBType & Record<string, unknown>;
type Convert = (value: DuckDBValue) => unknown;

const MS_PER_DAY = 86_400_000;

/** The Arrow type name DuckDB-WASM gives a column of this type. */
function arrowTypeName(type: DuckDBType): string {
  const typed = type as Typed;
  switch (type.typeId) {
    case T.BOOLEAN:
      return 'Bool';
    case T.TINYINT:
      return 'Int8';
    case T.SMALLINT:
      return 'Int16';
    case T.INTEGER:
      return 'Int32';
    case T.BIGINT:
      return 'Int64';
    case T.UTINYINT:
      return 'Uint8';
    case T.USMALLINT:
      return 'Uint16';
    case T.UINTEGER:
      return 'Uint32';
    case T.UBIGINT:
      return 'Uint64';
    case T.HUGEINT:
      return 'Decimal[38e0]';
    case T.UHUGEINT:
      return 'FixedSizeBinary[16]';
    case T.FLOAT:
      return 'Float32';
    case T.DOUBLE:
      return 'Float64';
    case T.DECIMAL: {
      const scale = typed.scale as number;
      return `Decimal[${typed.width as number}e${scale > 0 ? '+' : ''}${scale}]`;
    }
    case T.VARCHAR:
    case T.UUID:
      return 'Utf8';
    case T.BLOB:
    case T.BIT:
    case T.BIGNUM:
      return 'Binary';
    case T.DATE:
      return 'Date32<DAY>';
    case T.TIME:
    case T.TIME_TZ:
      return 'Time64<MICROSECOND>';
    case T.TIME_NS:
      return 'Time64<NANOSECOND>';
    case T.TIMESTAMP:
      return 'Timestamp<MICROSECOND>';
    case T.TIMESTAMP_S:
      return 'Timestamp<SECOND>';
    case T.TIMESTAMP_MS:
      return 'Timestamp<MILLISECOND>';
    case T.TIMESTAMP_NS:
      return 'Timestamp<NANOSECOND>';
    case T.TIMESTAMP_TZ:
      return `Timestamp<MICROSECOND, ${ARROW_TIME_ZONE}>`;
    case T.INTERVAL:
      return 'Interval<MONTH_DAY_NANO>';
    case T.ENUM: {
      const internal = typed.internalTypeId as number;
      return `Dictionary<${internal === T.UTINYINT ? 'Uint8' : internal === T.USMALLINT ? 'Uint16' : 'Uint32'}, Utf8>`;
    }
    case T.LIST:
      return `List<${arrowTypeName(typed.valueType as DuckDBType)}>`;
    case T.ARRAY:
      return `FixedSizeList[${typed.length as number}]<${arrowTypeName(typed.valueType as DuckDBType)}>`;
    case T.STRUCT: {
      const names = typed.entryNames as readonly string[];
      const types = typed.entryTypes as readonly DuckDBType[];
      return `Struct<{${names.map((name, index) => `${name}:${arrowTypeName(types[index]!)}`).join(', ')}}>`;
    }
    case T.MAP:
      return `Map<{key:${arrowTypeName(typed.keyType as DuckDBType)}, value:${arrowTypeName(typed.valueType as DuckDBType)}}>`;
    case T.UNION:
      return `Union<${(typed.memberTypes as readonly DuckDBType[]).map(arrowTypeName).join(' | ')}>`;
    case T.SQLNULL:
      return 'Null';
    default:
      return type.toString();
  }
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const finite = (value: number) => (Number.isFinite(value) ? value : String(value));
const text = (value: DuckDBValue) => String(value);

/** Epoch milliseconds of a date or timestamp value, as apache-arrow computes them. */
function epochMs(typeId: number): ((value: Record<string, bigint | number>) => number) | null {
  switch (typeId) {
    case T.DATE:
      return value => (value.days as number) * MS_PER_DAY;
    case T.TIMESTAMP:
    case T.TIMESTAMP_TZ:
      return value => Number(value.micros) / 1000;
    case T.TIMESTAMP_S:
      return value => Number(value.seconds) * 1000;
    case T.TIMESTAMP_MS:
      return value => Number(value.millis);
    case T.TIMESTAMP_NS:
      return value => Number(value.nanos) / 1_000_000;
    default:
      return null;
  }
}

/** Shared by both levels; null means the level decides. */
function scalar(type: DuckDBType): Convert | null {
  switch (type.typeId) {
    case T.BOOLEAN:
    case T.TINYINT:
    case T.SMALLINT:
    case T.INTEGER:
    case T.UTINYINT:
    case T.USMALLINT:
    case T.UINTEGER:
    case T.VARCHAR:
    case T.ENUM:
      return value => value;
    case T.FLOAT:
    case T.DOUBLE:
      return value => finite(value as number);
    case T.BIGINT:
    case T.UBIGINT:
    case T.HUGEINT:
    case T.UHUGEINT:
    case T.BIGNUM:
    case T.UUID:
    case T.INTERVAL:
    case T.TIME_TZ:
      return text;
    case T.TIME:
      return value => String((value as unknown as { micros: bigint }).micros);
    case T.TIME_NS:
      return value => String((value as unknown as { nanos: bigint }).nanos);
    case T.DECIMAL:
      return value => {
        const decimal = value as unknown as { value: bigint; scale: number };
        return formatDecimalText(decimal.value, decimal.scale);
      };
    case T.BLOB:
      return value => base64((value as unknown as { bytes: Uint8Array }).bytes);
    case T.BIT:
      return text;
    default:
      return null;
  }
}

function composite(type: DuckDBType, child: (type: DuckDBType) => Convert): Convert | null {
  const typed = type as Typed;
  switch (type.typeId) {
    case T.LIST:
    case T.ARRAY: {
      const item = child(typed.valueType as DuckDBType);
      return value => (value as unknown as { items: readonly DuckDBValue[] }).items.map(entry => (entry === null ? null : item(entry)));
    }
    case T.STRUCT: {
      const names = typed.entryNames as readonly string[];
      const fields = (typed.entryTypes as readonly DuckDBType[]).map(child);
      return value => {
        const entries = (value as unknown as { entries: Record<string, DuckDBValue> }).entries;
        const out: Record<string, unknown> = {};
        names.forEach((name, index) => {
          const entry = entries[name];
          out[name] = entry === null || entry === undefined ? null : fields[index]!(entry);
        });
        return out;
      };
    }
    case T.MAP: {
      const key = child(typed.keyType as DuckDBType);
      const item = child(typed.valueType as DuckDBType);
      return value => {
        const out: Record<string, unknown> = {};
        for (const entry of (value as unknown as { entries: Array<{ key: DuckDBValue; value: DuckDBValue }> }).entries) {
          out[String(entry.key === null ? null : key(entry.key))] = entry.value === null ? null : item(entry.value);
        }
        return out;
      };
    }
    case T.UNION: {
      const tags = typed.memberTags as readonly string[];
      const members = (typed.memberTypes as readonly DuckDBType[]).map(child);
      return value => {
        const union = value as unknown as { tag: string; value: DuckDBValue };
        const member = members[tags.indexOf(union.tag)];
        return union.value === null || !member ? null : member(union.value);
      };
    }
    default:
      return null;
  }
}

/** Inside a LIST, STRUCT, MAP or UNION: WASM leaves dates and timestamps as epoch milliseconds. */
function nested(type: DuckDBType): Convert {
  const millis = epochMs(type.typeId);
  if (millis) return value => millis(value as unknown as Record<string, bigint | number>);
  return scalar(type) ?? composite(type, nested) ?? text;
}

/** A top-level cell: dates and timestamps become the same text the WASM preview shows. */
export function cellConverter(type: DuckDBType): Convert {
  const millis = epochMs(type.typeId);
  if (millis) {
    const format = temporalFormatter(arrowTypeName(type))!;
    return value => format(millis(value as unknown as Record<string, bigint | number>));
  }
  return scalar(type) ?? composite(type, nested) ?? text;
}

export function columnsOf(names: readonly string[], types: readonly DuckDBType[]): SqlColumnMetadata[] {
  return names.map((name, index) => ({ name, type: arrowTypeName(types[index]!) }));
}

/** One row object per row, built in column order so a repeated name keeps the last value, like an Arrow row. */
export function rowsOf(
  names: readonly string[],
  converters: readonly Convert[],
  rows: readonly (readonly DuckDBValue[])[]
): Array<Record<string, unknown>> {
  return rows.map(row => {
    const out: Record<string, unknown> = {};
    for (let index = 0; index < names.length; index += 1) {
      const value = row[index];
      out[names[index]!] = value === null || value === undefined ? null : converters[index]!(value);
    }
    return out;
  });
}
