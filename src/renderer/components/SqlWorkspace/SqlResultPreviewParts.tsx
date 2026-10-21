import { AlertTriangle, ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  SqlColumnMetadata,
  SqlResponseV1,
} from '../../../shared/sqlWorkspace';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';
import type { SqlSortState } from './sqlResultGrid';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';

export function ErrorBand({
  status,
  message,
  querySource,
  onApplyFix,
}: {
  status: SqlResponseV1['status'];
  message: string | undefined;
  querySource?: string;
  onApplyFix?: (sql: string) => void;
}) {
  const { t } = useTranslation();
  const bandKey =
    status === 'timeout'
      ? 'sqlWorkspace.response.timeoutBand'
      : status === 'engine-load-failed'
        ? 'sqlWorkspace.response.engineLoadFailedBand'
        : 'sqlWorkspace.response.errorBand';
  const hintKey =
    status === 'engine-load-failed'
      ? 'sqlWorkspace.response.engineLoadFailedHint'
      : null;
  return (
    <div
      role="alert"
      data-testid={`sql-result-preview-error-${status}`}
      className="border-b border-error-border bg-error-bg px-3 py-2 text-caption text-error-fg"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={12}
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold">{t(bandKey)}</p>
          {/* A timeout's message is our own English text; the band already says it. */}
          {message && status !== 'timeout' ? (
            <pre className="mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap break-all rounded bg-error-bg p-2 font-mono text-eyebrow text-error-fg">
              {message}
            </pre>
          ) : null}
          {hintKey ? (
            <p className="mt-1 text-eyebrow text-error-fg/80">{t(hintKey)}</p>
          ) : null}
          {status === 'sql-error' && message && querySource ? (
            <div className="mt-2">
              <ExplainErrorButton
                errorMessage={message}
                code={querySource}
                language="sql"
                {...(onApplyFix ? { onApplyFix } : {})}
                testId="sql-explain-error"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ResultTableProps {
  columns: ReadonlyArray<SqlColumnMetadata>;
  rows: ReadonlyArray<Record<string, unknown>>;
  sort: SqlSortState;
  onSort: (column: string) => void;
  selectedRowIndex?: number | null;
  onSelectRow?: (index: number) => void;
}

export function ResultTable({
  columns,
  rows,
  sort,
  onSort,
  selectedRowIndex = null,
  onSelectRow,
}: ResultTableProps) {
  const { t } = useTranslation();
  const typed = useMemo(
    () =>
      columns.map((col) => {
        const duckType = arrowTypeToDuckDb(col.type);
        return { col, duckType, numeric: isNumericSqlType(duckType) };
      }),
    [columns]
  );
  return (
    <table
      data-testid="sql-result-preview-table"
      role="grid"
      aria-rowcount={rows.length + 1}
      className="w-max border-collapse font-mono text-caption"
    >
      <thead className="sticky top-0 z-10 bg-bg-panel">
        <tr>
          {typed.map(({ col, duckType, numeric }) => {
            const isSorted = sort.column === col.name;
            const ariaSort = isSorted
              ? sort.direction === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none';
            return (
              <th
                key={col.name}
                scope="col"
                aria-sort={ariaSort}
                className={`h-7 whitespace-nowrap border-b border-border-subtle p-0 font-normal ${numeric ? 'min-w-[8.125rem]' : 'min-w-[12.5rem]'}`}
              >
                <button
                  type="button"
                  onClick={() => onSort(col.name)}
                  data-testid="sql-result-preview-sort"
                  data-column={col.name}
                  data-sort={isSorted ? sort.direction : 'none'}
                  title={t('sqlWorkspace.grid.sortBy', { name: col.name })}
                  className={`flex w-full items-center gap-1.5 overflow-hidden px-2.5 py-1.5 transition-colors hover:bg-bg-panel-alt/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 ${numeric ? 'justify-end text-right' : 'text-left'}`}
                >
                  <span className="shrink-0 text-fg-subtle">{col.name}</span>
                  <span
                    data-testid="sql-result-preview-type"
                    className="min-w-0 truncate text-micro tracking-[0.04em] text-fg-subtle/70"
                    title={t('sqlWorkspace.grid.arrowType', { type: col.type })}
                  >
                    {duckType}
                  </span>
                  {isSorted ? (
                    sort.direction === 'asc' ? (
                      <ArrowUp size={10} aria-hidden="true" className="shrink-0 text-fg-base" />
                    ) : (
                      <ArrowDown size={10} aria-hidden="true" className="shrink-0 text-fg-base" />
                    )
                  ) : null}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const selected = selectedRowIndex === idx;
          return (
            <tr
              key={idx}
              data-testid="sql-result-preview-row"
              aria-selected={selected}
              data-selected={selected ? 'true' : undefined}
              onClick={() => onSelectRow?.(idx)}
              className={`h-[26px] border-b border-border-subtle ${selected ? 'bg-editor-line-hl' : 'hover:bg-bg-panel-alt/60'}`}
            >
              {typed.map(({ col, numeric }) => {
                const value = row[col.name];
                const isNull = value === null || value === undefined;
                return (
                  <td
                    key={col.name}
                    role="gridcell"
                    data-null={isNull ? 'true' : undefined}
                    className={cellClass(value, numeric)}
                  >
                    {renderCell(value)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Numbers right-aligned in the number color, null italic and subtle, the rest in the base text color. */
function cellClass(value: unknown, numeric: boolean): string {
  const base = 'max-w-[32rem] truncate px-2.5 align-middle';
  if (value === null || value === undefined) {
    return `${base} italic text-fg-subtle ${numeric ? 'text-right' : ''}`;
  }
  if (numeric) return `${base} text-right tabular-nums text-syntax-number`;
  if (typeof value === 'boolean') return `${base} text-syntax-keyword`;
  return `${base} text-fg-base`;
}

export function JsonView({
  rows,
}: {
  rows: ReadonlyArray<Record<string, unknown>>;
}) {
  const serialized = useMemo(() => {
    try {
      return JSON.stringify(rows, jsonReplacer, 2);
    } catch {
      return String(rows);
    }
  }, [rows]);
  return (
    <pre
      data-testid="sql-result-preview-json"
      className="overflow-auto px-3 py-2 font-mono text-body-sm leading-[1.7] text-fg-base"
    >
      {serialized}
    </pre>
  );
}

/** BigInt is not JSON-serializable; coerce to a string so the view
 * never throws on integer columns DuckDB returns as BigInt. */
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
