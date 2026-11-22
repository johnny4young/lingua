import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleStop, Play } from 'lucide-react';
import '../../i18n/testsCatalog';
import { useProjectStore } from '../../stores/projectStore';
import { isCurrentFailure, useProjectTestStore } from '../../stores/projectTestStore';
import './testsDock.css';

/** The Tests filter and Run all tests, on the dock's tab row while Tests is on screen. */
export function TestsDockControls() {
  const { t } = useTranslation();
  const project = useProjectStore(state => state.currentProject);
  const rootId = useProjectTestStore(state => state.rootId);
  const status = useProjectTestStore(state => state.status);
  const detection = useProjectTestStore(state => state.detection);
  const selectedFramework = useProjectTestStore(state => state.selectedFramework);
  const cases = useProjectTestStore(state => state.cases);
  const filter = useProjectTestStore(state => state.filter);
  const setFilter = useProjectTestStore(state => state.setFilter);
  const run = useProjectTestStore(state => state.run);
  const stop = useProjectTestStore(state => state.stop);
  const failed = useMemo(() => cases?.filter(isCurrentFailure).length ?? 0, [cases]);

  if (!project || rootId !== project.rootId || !detection || detection.kind === 'none') return null;
  const binding = { rootId: project.rootId, projectName: project.name };
  const running = status === 'running';
  const candidate = detection.candidates.find(entry => entry.framework === selectedFramework);
  const canRun = Boolean(candidate?.available) && !running;
  const counts = { all: cases?.length ?? 0, failed };
  const runLabel = t(running ? 'projectTests.stop' : 'projectTests.runAll');

  return (
    <div className="tests-dock-controls flex shrink-0 items-center gap-2" data-testid="tests-dock-controls">
      {cases && cases.length > 0 ? (
        <div role="radiogroup" aria-label={t('projectTests.filter.label')} className="tests-dock-filter">
          {(['all', 'failed'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={filter === option}
              onClick={() => setFilter(option)}
              data-testid={`tests-filter-${option}`}
              className="tests-dock-filter-option"
            >
              {t(`projectTests.filter.${option}`)}
              <span className="tests-dock-filter-count">{counts[option]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={running ? 'tests-dock-run tests-dock-run-stop' : 'tests-dock-run'}
        disabled={!running && !canRun}
        onClick={() => void (running ? stop(binding) : run(binding, { kind: 'all' }))}
        data-testid={running ? 'tests-stop' : 'tests-run-all'}
        aria-label={runLabel}
        title={runLabel}
      >
        {running ? <CircleStop size={12} aria-hidden="true" /> : <Play size={11} fill="currentColor" aria-hidden="true" />}
        <span className="tests-dock-run-label">{runLabel}</span>
      </button>
    </div>
  );
}
