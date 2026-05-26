/**
 * RL-097 Slice 2 fold A — Color-coded SQL status pill.
 *
 * Mirrors `<HttpStatusPill>` (RL-097 Slice 1 fold C):
 *
 *   - success → emerald (DuckDB returned rows).
 *   - sql-error → rose (DuckDB threw, user-actionable).
 *   - timeout → amber (soft-timed-out via Promise.race; user can
 *     close + reopen the tab to free the worker).
 *   - too-large → amber (DuckDB succeeded but we capped the preview).
 *   - engine-load-failed → slate (no signal from DuckDB; offline
 *     / blocked / boot-time WASM rejection).
 *
 * The pill renders compact (10 px text, 6 px padding) so it fits in
 * the result preview header without competing with the table for
 * vertical space.
 */

import { useTranslation } from 'react-i18next';
import type { SqlQueryStatus } from '../../../shared/sqlWorkspace';

type PillTone = 'emerald' | 'amber' | 'rose' | 'slate';

const TONE_CLASS: Record<PillTone, string> = {
  emerald:
    'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 ring-1 ring-emerald-500/30',
  amber:
    'text-amber-700 dark:text-amber-300 bg-amber-500/15 ring-1 ring-amber-500/30',
  rose: 'text-rose-700 dark:text-rose-300 bg-rose-500/15 ring-1 ring-rose-500/30',
  slate: 'text-muted bg-surface-strong/40 ring-1 ring-border/40',
};

function toneForStatus(status: SqlQueryStatus): PillTone {
  if (status === 'success') return 'emerald';
  if (status === 'sql-error') return 'rose';
  if (status === 'timeout' || status === 'too-large') return 'amber';
  return 'slate';
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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-[14px] tabular-nums ${TONE_CLASS[tone]}`}
    >
      <span>{label}</span>
      {showStats && rowCount !== undefined ? (
        <span className="opacity-70">
          · {t('sqlWorkspace.response.rowCount', { count: rowCount })}
        </span>
      ) : null}
      {showStats && durationMs !== undefined ? (
        <span className="opacity-70">· {Math.max(0, Math.round(durationMs))} ms</span>
      ) : null}
    </span>
  );
}
