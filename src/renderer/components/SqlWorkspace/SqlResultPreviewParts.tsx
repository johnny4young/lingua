import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlResponseV1 } from '../../../shared/sqlWorkspace';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';

export function ErrorBand({
  status,
  message,
  querySource,
  onApplyFix,
  engine,
}: {
  engine?: SqlResponseV1['engine'];
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
        : status === 'connection-failed'
          ? 'sqlWorkspace.response.connectionFailedBand'
          : status === 'blocked-target'
            ? 'sqlWorkspace.response.blockedTargetBand'
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
                {...(engine && engine !== 'duckdb' ? { sqlEngine: engine } : {})}
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
