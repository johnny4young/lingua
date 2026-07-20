/**
 * implementation note — Color-coded SQL status pill.
 *
 * FASE 2b (MOV.05) — converged onto the shared `<StatusBadge>`
 * primitive. The five-state classifier survives; only the chip shell
 * changes. The DuckDB-status → tone mapping is:
 *
 *   - success → success (DuckDB returned rows).
 *   - sql-error → error (DuckDB threw, user-actionable).
 *   - timeout → warning (soft-timed-out via Promise.race; user can
 *     close + reopen the tab to free the worker).
 *   - too-large → warning (DuckDB succeeded but we capped the preview).
 *   - engine-load-failed → neutral (no signal from DuckDB; offline
 *     / blocked / boot-time WASM rejection).
 *
 * Per the Signal-Slate recipe the row-count + duration stats sit
 * beside the badge as quiet mono meta, not inside the uppercase chip.
 */

import { useTranslation } from 'react-i18next';
import type { SqlQueryStatus } from '../../../shared/sqlWorkspace';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';

function toneForStatus(status: SqlQueryStatus): StatusBadgeTone {
  if (status === 'success') return 'success';
  if (status === 'sql-error') return 'error';
  if (status === 'timeout' || status === 'too-large') return 'warning';
  return 'neutral';
}

export interface SqlStatusPillProps {
  status: SqlQueryStatus;
  rowCount?: number;
  durationMs?: number;
}

export function SqlStatusPill({ status, rowCount, durationMs }: SqlStatusPillProps) {
  const { t } = useTranslation();
  const tone = toneForStatus(status);
  const label = t(`sqlWorkspace.statusPill.${status}`);
  const showStats = status === 'success' || status === 'too-large';
  return (
    <span
      data-testid="sql-status-pill"
      data-tone={tone}
      data-status={status}
      className="inline-flex items-center gap-1.5"
    >
      <StatusBadge tone={tone} dot>
        {label}
      </StatusBadge>
      {showStats && rowCount !== undefined ? (
        <span className="font-mono text-eyebrow tabular-nums text-fg-subtle">
          {t('sqlWorkspace.response.rowCount', { count: rowCount })}
        </span>
      ) : null}
      {showStats && durationMs !== undefined ? (
        <span className="font-mono text-eyebrow tabular-nums text-fg-subtle">
          · {Math.max(0, Math.round(durationMs))} ms
        </span>
      ) : null}
    </span>
  );
}
