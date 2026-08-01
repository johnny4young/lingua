import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  TerminalSquare,
} from 'lucide-react';
import type { ProjectTestCandidate, ProjectTestRunKind } from '../../../shared/projectTests';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectTestStore, type ProjectTestBinding } from '../../stores/projectTestStore';
import { cn } from '../../utils/cn';
import { EmptyState } from '../ui/EmptyState';
import { ModalShell } from '../ui/ModalShell';
import { MonoBadge, Pill } from '../ui/primitives';

interface ProjectTestsOverlayProps {
  onClose: () => void;
}

function resultTone(kind: ProjectTestRunKind): 'success' | 'warning' | 'error' {
  if (kind === 'success') return 'success';
  if (
    kind === 'stopped' ||
    kind === 'timed-out' ||
    kind === 'unavailable' ||
    kind === 'not-detected' ||
    kind === 'busy'
  ) return 'warning';
  return 'error';
}

function RunnerCard({
  candidate,
  selected,
  disabled,
  onSelect,
}: {
  candidate: ProjectTestCandidate;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-testid={`project-tests-runner-${candidate.framework}`}
      className={cn(
        'focus-ring flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-accent/60 bg-primary-soft/70'
          : 'border-border-subtle bg-bg-inset hover:border-border-strong',
        disabled && 'cursor-not-allowed opacity-55'
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-display text-body font-semibold text-fg-base">
          {t(`projectTests.framework.${candidate.framework}`)}
        </span>
        <Pill tone={candidate.available ? 'success' : 'warning'}>
          {t(candidate.available ? 'projectTests.runner.ready' : 'projectTests.runner.unavailable')}
        </Pill>
      </span>
      <code className="truncate font-mono text-caption text-fg-muted" title={candidate.command}>
        {candidate.command}
      </code>
      <span className="flex flex-wrap gap-1">
        {candidate.evidence.map(item => (
          <span
            key={item}
            className="rounded border border-border-subtle bg-bg-panel px-1.5 py-0.5 font-mono text-eyebrow text-fg-subtle"
          >
            {item}
          </span>
        ))}
      </span>
      {!candidate.available ? (
        <span className="text-caption leading-relaxed text-warning">
          {t(`projectTests.unavailable.${candidate.unavailableReason}`)}
        </span>
      ) : null}
    </button>
  );
}

function OutputBlock({ label, value, testId }: { label: string; value: string; testId: string }) {
  if (!value) return null;
  return (
    <section className="min-h-0">
      <h3 className="mb-1 text-eyebrow font-semibold uppercase tracking-[0.14em] text-fg-subtle">
        {label}
      </h3>
      <pre
        data-testid={testId}
        className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-bg-inset p-3 font-mono text-caption leading-relaxed text-fg-base"
      >
        {value}
      </pre>
    </section>
  );
}

export function ProjectTestsOverlay({ onClose }: ProjectTestsOverlayProps) {
  const { t } = useTranslation();
  const currentProject = useProjectStore(state => state.currentProject);
  const openProject = useProjectStore(state => state.openProject);
  const rootId = useProjectTestStore(state => state.rootId);
  const status = useProjectTestStore(state => state.status);
  const detection = useProjectTestStore(state => state.detection);
  const selectedFramework = useProjectTestStore(state => state.selectedFramework);
  const result = useProjectTestStore(state => state.result);
  const liveOutput = useProjectTestStore(state => state.liveOutput);
  const error = useProjectTestStore(state => state.error);
  const detect = useProjectTestStore(state => state.detect);
  const selectFramework = useProjectTestStore(state => state.selectFramework);
  const run = useProjectTestStore(state => state.run);
  const stop = useProjectTestStore(state => state.stop);
  const bridgeAvailable = window.lingua?.projectTests !== undefined;

  const binding = useMemo<ProjectTestBinding | null>(
    () =>
      currentProject ? { rootId: currentProject.rootId, projectName: currentProject.name } : null,
    [currentProject]
  );

  useEffect(() => {
    if (binding && rootId !== binding.rootId) void detect(binding);
  }, [binding, detect, rootId]);

  const selectedCandidate = detection?.candidates.find(
    candidate => candidate.framework === selectedFramework
  );
  const isRunning = status === 'running';
  const canRun = Boolean(binding && bridgeAvailable && selectedCandidate?.available && !isRunning);

  return (
    <ModalShell
      onClose={onClose}
      size="max-w-4xl"
      labelledById="project-tests-title"
      headerClose="button"
      closeLabel={t('projectTests.close')}
      icon={<FlaskConical size={16} aria-hidden="true" />}
      header={
        <div className="min-w-0">
          <h2 id="project-tests-title" className="truncate text-body-lg font-semibold text-fg-base">
            {t('projectTests.title')}
          </h2>
          <p className="mt-0.5 truncate text-body-sm text-fg-subtle">
            {currentProject
              ? t('projectTests.subtitle.project', { project: currentProject.name })
              : t('projectTests.subtitle.noProject')}
          </p>
        </div>
      }
      footerLegend={
        <span className="font-mono text-caption text-fg-subtle">
          {t('projectTests.footer.localOnly')}
        </span>
      }
      trailing={
        binding && bridgeAvailable ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="button-secondary inline-flex items-center gap-2"
              onClick={() => void detect(binding)}
              disabled={isRunning || status === 'detecting'}
              data-testid="project-tests-refresh"
            >
              <RefreshCw size={13} aria-hidden="true" />
              {t('projectTests.refresh')}
            </button>
            {isRunning ? (
              <button
                type="button"
                className="button-danger inline-flex items-center gap-2"
                onClick={() => void stop(binding)}
                data-testid="project-tests-stop"
              >
                <CircleStop size={13} aria-hidden="true" />
                {t('projectTests.stop')}
              </button>
            ) : (
              <button
                type="button"
                className="button-primary inline-flex items-center gap-2"
                onClick={() => binding && void run(binding)}
                disabled={!canRun}
                data-testid="project-tests-run"
              >
                <Play size={13} fill="currentColor" aria-hidden="true" />
                {t('projectTests.run')}
              </button>
            )}
          </div>
        ) : null
      }
    >
      <div data-testid="project-tests-overlay" className="grid min-h-[420px] gap-4 p-1">
        {!currentProject ? (
          <EmptyState
            className="my-auto"
            icon={<FlaskConical size={18} aria-hidden="true" />}
            title={t('projectTests.empty.noProject.title')}
            description={t('projectTests.empty.noProject.description')}
            action={
              <button type="button" className="button-primary" onClick={() => void openProject()}>
                {t('projectTests.empty.noProject.action')}
              </button>
            }
          />
        ) : !bridgeAvailable ? (
          <EmptyState
            className="my-auto"
            icon={<TerminalSquare size={18} aria-hidden="true" />}
            title={t('projectTests.empty.desktop.title')}
            description={t('projectTests.empty.desktop.description')}
          />
        ) : status === 'detecting' ? (
          <div className="my-auto flex flex-col items-center gap-3 text-center" role="status">
            <Loader2 size={24} className="animate-spin text-accent" aria-hidden="true" />
            <span className="text-body text-fg-subtle">{t('projectTests.detecting')}</span>
          </div>
        ) : error ? (
          <EmptyState
            className="my-auto"
            icon={<AlertTriangle size={18} aria-hidden="true" />}
            title={t(`projectTests.error.${error}.title`)}
            description={t(`projectTests.error.${error}.description`)}
            action={
              <button
                type="button"
                className="button-secondary"
                onClick={() => binding && void detect(binding)}
              >
                {t('projectTests.retry')}
              </button>
            }
          />
        ) : detection?.kind === 'none' ? (
          <EmptyState
            className="my-auto"
            icon={<FlaskConical size={18} aria-hidden="true" />}
            title={t('projectTests.empty.none.title')}
            description={t('projectTests.empty.none.description')}
          />
        ) : (
          <>
            <section>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-body font-semibold text-fg-base">
                    {t('projectTests.detected.title')}
                  </h3>
                  <p className="mt-0.5 text-body-sm text-fg-subtle">
                    {t('projectTests.detected.description', {
                      count: detection?.candidates.length ?? 0,
                    })}
                  </p>
                </div>
                <MonoBadge>
                  {t('projectTests.detected.count', { count: detection?.candidates.length ?? 0 })}
                </MonoBadge>
              </div>
              <div
                role="radiogroup"
                aria-label={t('projectTests.detected.aria')}
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
              >
                {detection?.candidates.map(candidate => (
                  <RunnerCard
                    key={candidate.framework}
                    candidate={candidate}
                    selected={candidate.framework === selectedFramework}
                    disabled={isRunning}
                    onSelect={() => selectFramework(candidate.framework)}
                  />
                ))}
              </div>
            </section>

            <section className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/8 p-3">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-warning"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-body-sm font-semibold text-fg-base">
                  {t('projectTests.trust.title')}
                </h3>
                <p className="mt-0.5 text-caption leading-relaxed text-fg-subtle">
                  {t('projectTests.trust.description')}
                </p>
              </div>
            </section>

            {isRunning ? (
              <section
                data-testid="project-tests-running"
                className="flex items-center gap-3 rounded-lg border border-accent/30 bg-primary-soft/60 p-4"
                role="status"
              >
                <Loader2 size={18} className="animate-spin text-accent" aria-hidden="true" />
                <div>
                  <p className="text-body font-semibold text-fg-base">
                    {t('projectTests.running.title', {
                      framework: selectedFramework
                        ? t(`projectTests.framework.${selectedFramework}`)
                        : '',
                    })}
                  </p>
                  <p className="mt-0.5 font-mono text-caption text-fg-subtle">
                    {selectedCandidate?.command}
                  </p>
                </div>
              </section>
            ) : null}

            {isRunning && (liveOutput.stdout || liveOutput.stderr) ? (
              <section
                data-testid="project-tests-live-output"
                className="grid gap-3"
                aria-live="polite"
              >
                <OutputBlock
                  label={t('projectTests.output.stdout')}
                  value={liveOutput.stdout}
                  testId="project-tests-live-stdout"
                />
                <OutputBlock
                  label={t('projectTests.output.stderr')}
                  value={liveOutput.stderr}
                  testId="project-tests-live-stderr"
                />
              </section>
            ) : null}

            {result ? (
              <section data-testid="project-tests-result" className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {result.kind === 'success' ? (
                    <CheckCircle2 size={16} className="text-success" aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={16} className="text-warning" aria-hidden="true" />
                  )}
                  <Pill tone={resultTone(result.kind)}>
                    {t(`projectTests.result.${result.kind}`)}
                  </Pill>
                  {result.command ? <MonoBadge>{result.command}</MonoBadge> : null}
                  {result.kind !== 'not-detected' &&
                  result.kind !== 'unavailable' &&
                  result.kind !== 'busy' &&
                  result.kind !== 'invalid-request' ? (
                    <>
                      <MonoBadge>
                        {t('projectTests.result.exitCode', { code: result.exitCode })}
                      </MonoBadge>
                      <MonoBadge>
                        {t('projectTests.result.duration', { ms: result.executionTime })}
                      </MonoBadge>
                    </>
                  ) : null}
                </div>
                {result.kind === 'unavailable' && result.unavailableReason ? (
                  <p className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-body-sm text-warning">
                    {t(`projectTests.unavailable.${result.unavailableReason}`)}
                  </p>
                ) : null}
                <OutputBlock
                  label={t('projectTests.output.stdout')}
                  value={result.stdout}
                  testId="project-tests-stdout"
                />
                <OutputBlock
                  label={t('projectTests.output.stderr')}
                  value={result.stderr}
                  testId="project-tests-stderr"
                />
                {!result.stdout && !result.stderr ? (
                  <p className="rounded-lg border border-border-subtle bg-bg-inset p-3 text-body-sm text-fg-subtle">
                    {t('projectTests.output.empty')}
                  </p>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </ModalShell>
  );
}
