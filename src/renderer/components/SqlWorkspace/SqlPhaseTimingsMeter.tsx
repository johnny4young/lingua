import { useTranslation } from 'react-i18next';
import { SQL_PHASES, type SqlPhase, type SqlPhaseTimings } from '../../../shared/sqlWorkspace';
import { PhaseBar } from '../ui/PhaseBar';

const COLOR: Record<SqlPhase, string> = {
  plan: 'var(--color-fg-subtle)',
  execute: 'var(--color-accent)',
  fetch: 'var(--color-fg-muted)',
};

/** How one statement's time split across the phases its engine measured. */
export function SqlPhaseTimingsMeter({ phases }: { phases: SqlPhaseTimings }) {
  const { t } = useTranslation();
  const segments = SQL_PHASES.flatMap((phase) => {
    const ms = phases[phase];
    return ms === undefined ? [] : [{ key: phase, ms, color: COLOR[phase] }];
  });
  const label = segments.map(({ key, ms }) => t(`sqlWorkspace.response.phase.${key}`, { ms })).join(' · ');
  return (
    <span data-testid="sql-result-phases" title={label} className="ml-2.5 inline-flex items-center gap-2.5 align-middle">
      <PhaseBar aria-hidden="true" segments={segments} className="h-1.5 w-[120px]" />
      <span data-testid="sql-result-phases-label" className="sr-only lg:not-sr-only">
        {label}
      </span>
    </span>
  );
}
