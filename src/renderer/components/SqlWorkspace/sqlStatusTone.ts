import type { SqlQueryStatus } from '../../../shared/sqlWorkspace';
import type { StatusBadgeTone } from '../ui/StatusBadge';

export function toneForSqlStatus(status: SqlQueryStatus): StatusBadgeTone {
  if (status === 'success') return 'success';
  if (status === 'sql-error') return 'error';
  if (status === 'timeout' || status === 'too-large') return 'warning';
  return 'neutral';
}
