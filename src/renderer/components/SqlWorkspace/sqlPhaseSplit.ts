import type { TFunction } from 'i18next';
import { SQL_PHASES, type SqlPhase, type SqlPhaseTimings } from '../../../shared/sqlWorkspace';
import type { ResultHeaderPhases } from '../ui/ResultHeader';

const COLOR: Record<SqlPhase, string> = {
  plan: 'var(--color-fg-subtle)',
  execute: 'var(--color-accent)',
  fetch: 'var(--color-fg-muted)',
};

/** How one statement's time split across the phases its engine measured. */
export function sqlPhaseSplit(phases: SqlPhaseTimings, t: TFunction): ResultHeaderPhases {
  const segments = SQL_PHASES.flatMap((phase) => {
    const ms = phases[phase];
    return ms === undefined ? [] : [{ key: phase, ms, color: COLOR[phase] }];
  });
  const label = segments.map(({ key, ms }) => t(`sqlWorkspace.response.phase.${key}`, { ms })).join(' · ');
  return { segments, label, testId: 'sql-result-phases' };
}
