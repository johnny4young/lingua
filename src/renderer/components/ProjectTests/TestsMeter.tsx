import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n/testsCatalog';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectTestStore } from '../../stores/projectTestStore';
import { formatWholeDuration } from '../../utils/latencyScale';
import { tallyTests } from '../FileTree/fileTreeMarks';
import { ResultNumeral } from '../ui/answer';
import { RunDot } from '../ui/RunStateGlyph';
import type { TabRunState } from '../ui/runState';
import { countByStatus, testsMeterBars } from './testsMeterModel';
import '../RunMeter/RunMeter.css';
import './testsDock.css';

type MeterState = 'idle' | 'running' | 'failed' | 'passed' | 'timed-out' | 'stopped';

const DOT: Record<MeterState, TabRunState | 'idle'> = {
  idle: 'idle',
  running: 'running',
  failed: 'error',
  passed: 'ok',
  'timed-out': 'error',
  stopped: 'stale',
};

/** The project's test answer at the left of the dock: passed of total, the runner, and the last runs. */
export function TestsMeter() {
  const { t } = useTranslation();
  const rootId = useProjectStore(state => state.currentProject?.rootId ?? null);
  const boundRoot = useProjectTestStore(state => state.rootId);
  const status = useProjectTestStore(state => state.status);
  const framework = useProjectTestStore(state => state.selectedFramework);
  const cases = useProjectTestStore(state => state.cases);
  const result = useProjectTestStore(state => state.result);
  const runs = useProjectTestStore(state => state.runs);
  const error = useProjectTestStore(state => state.error);
  const ours = rootId !== null && boundRoot === rootId;

  const tally = useMemo(() => (cases ? tallyTests(cases) : null), [cases]);
  const { failed, skipped, notRun } = useMemo(() => countByStatus(cases ?? []), [cases]);
  const bars = useMemo(() => testsMeterBars(ours ? runs : []), [ours, runs]);
  if (!ours) return null;

  const state: MeterState =
    status === 'running'
      ? 'running'
      : result?.kind === 'timed-out' || result?.kind === 'stopped'
        ? result.kind
        : // A run that failed before any test reported has no failed test to count.
          failed > 0 || error === 'run-failed' || (result?.kind === 'failed' && !result.cases?.length)
          ? 'failed'
          : tally && tally.all.total > 0
            ? 'passed'
            : 'idle';
  const stateLabel =
    state === 'failed'
      ? failed > 0
        ? t('projectTests.failed', { count: failed })
        : t('projectTests.meter.state.failed')
      : state === 'timed-out' || state === 'stopped'
        ? t(`projectTests.result.${state}`)
        : t(`projectTests.meter.state.${state}`);
  const details = [
    state !== 'failed' && failed > 0 ? t('projectTests.failed', { count: failed }) : '',
    skipped > 0 ? t('projectTests.skipped', { count: skipped }) : '',
    notRun > 0 ? t('projectTests.notRun', { count: notRun }) : '',
    framework ? t(`projectTests.framework.${framework}`) : '',
    tally && tally.byFile.size > 0 ? t('projectTests.count.files', { count: tally.byFile.size }) : '',
    status !== 'running' && result ? formatWholeDuration(result.executionTime) : '',
  ].filter(Boolean);
  const heading = [stateLabel, ...details].join(' · ');

  return (
    <section aria-label={t('projectTests.meter.label')} data-testid="tests-meter" data-state={state} className="run-meter tests-meter">
      <div className="run-meter-head">
        <div className="run-meter-state" title={heading} data-testid="tests-counts" aria-live="polite">
          <RunDot state={DOT[state] as TabRunState} />
          <span className="run-meter-state-name">{stateLabel}</span>
          {details.length > 0 ? <span className="run-meter-state-detail">· {details.join(' · ')}</span> : null}
        </div>
      </div>
      {tally && tally.all.total > 0 ? (
        <div className="run-meter-numeral tests-meter-numeral">
          <ResultNumeral
            size="xl"
            value={String(tally.all.passed)}
            unit={t('projectTests.meter.ofPassed', { total: tally.all.total })}
            data-testid="tests-meter-numeral"
          />
        </div>
      ) : null}
      {bars.length > 0 ? (
        <div className="tests-meter-runs">
          <div className="tests-meter-bars" role="group" aria-label={t('projectTests.meter.lastRuns', { count: bars.length })} data-testid="tests-meter-bars">
            {bars.map((bar, index) => {
              const { passed, failed: failedCount, kind } = bar.summary;
              const label = bar.empty
                ? t(`projectTests.meter.bar.empty`, { number: index + 1, outcome: t(`projectTests.meter.outcome.${kind}`) })
                : t('projectTests.meter.bar.counted', { number: index + 1, passed, failed: failedCount });
              return (
                <span
                  key={index}
                  role="img"
                  aria-label={label}
                  title={label}
                  className="tests-meter-bar"
                  data-testid="tests-meter-bar"
                  data-empty={bar.empty ? 'true' : undefined}
                  data-latest={bar.latest ? 'true' : undefined}
                >
                  {bar.failed > 0 ? <span className="tests-meter-bar-failed" style={{ flexGrow: bar.failed }} /> : null}
                  {bar.failed < 1 && !bar.empty ? <span className="tests-meter-bar-passed" style={{ flexGrow: 1 - bar.failed }} /> : null}
                </span>
              );
            })}
          </div>
          <span className="tests-meter-runs-label" aria-hidden>
            {t('projectTests.meter.lastRuns', { count: bars.length })}
          </span>
        </div>
      ) : null}
    </section>
  );
}
