import { AlertTriangle, ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  SqlColumnMetadata,
  SqlResponseV1,
} from '../../../shared/sqlWorkspace';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';
import type { SqlSortState } from './sqlResultGrid';

export function CopyButton({
  onClick,
  testId,
  label,
  icon,
}: {
  onClick: () => void;
  testId: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-default bg-bg-panel-alt text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {icon}
    </button>
  );
}

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
          {message ? (
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
}

export function ResultTable({ columns, rows, sort, onSort }: ResultTableProps) {
  const { t } = useTranslation();
  return (
    <table
      data-testid="sql-result-preview-table"
      className="w-full min-w-max table-fixed border-collapse font-mono text-body-sm"
    >
      <thead className="sticky top-0 z-10 bg-bg-base/95 backdrop-blur">
        <tr>
          {columns.map((col) => {
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
                className="whitespace-nowrap border-b border-border-subtle p-0 text-left"
              >
                <button
                  type="button"
                  onClick={() => onSort(col.name)}
                  data-testid="sql-result-preview-sort"
                  data-column={col.name}
                  data-sort={isSorted ? sort.direction : 'none'}
                  title={t('sqlWorkspace.grid.sortBy', { name: col.name })}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-bg-panel-alt/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                >
                  <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                    {col.name}
                  </span>
                  <span className="text-micro tracking-[0.04em] text-accent">
                    {col.type}
                  </span>
                  {isSorted ? (
                    sort.direction === 'asc' ? (
                      <ArrowUp
                        size={10}
                        aria-hidden="true"
                        className="ml-auto shrink-0 text-fg-base"
                      />
                    ) : (
                      <ArrowDown
                        size={10}
                        aria-hidden="true"
                        className="ml-auto shrink-0 text-fg-base"
                      />
                    )
                  ) : null}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={idx}
            data-testid="sql-result-preview-row"
            className="border-b border-border-subtle hover:bg-bg-panel-alt/60"
          >
            {columns.map((col) => (
              <td
                key={col.name}
                className={cellClass(row[col.name])}
              >
                {renderCell(row[col.name])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Token-only typed-column tinting — mirrors the prototype's per-type
 * color (string → syntax-string, boolean → syntax-keyword, numeric →
 * syntax-number, null → fg-subtle, fallback → fg-base).
 */
function cellClass(value: unknown): string {
  const base = 'break-all px-3 py-2 align-top';
  if (value === null || value === undefined) return `${base} text-fg-subtle`;
  if (typeof value === 'string') return `${base} text-syntax-string`;
  if (typeof value === 'boolean') return `${base} text-syntax-keyword`;
  if (typeof value === 'number' || typeof value === 'bigint')
    return `${base} text-syntax-number`;
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
  if (value === null || value === undefined) return '—';
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
