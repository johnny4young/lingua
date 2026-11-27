import type { SqlQueryStatus } from '../../../shared/sqlWorkspace';
import type { StatusBadgeTone } from '../ui/StatusBadge';

export function toneForSqlStatus(status: SqlQueryStatus): StatusBadgeTone {
  if (status === 'success') return 'success';
  if (status === 'sql-error') return 'error';
  if (status === 'timeout' || status === 'too-large') return 'warning';
  return 'neutral';
}

const DOT_CLASS: Partial<Record<StatusBadgeTone, string>> = {
  success: 'bg-success-fg',
  error: 'bg-error-fg',
  warning: 'bg-warning-fg',
};

/** A run's status as a dot's fill, beside its latency bar. */
export const sqlStatusDotClass = (status: SqlQueryStatus): string => DOT_CLASS[toneForSqlStatus(status)] ?? 'bg-fg-subtle';
