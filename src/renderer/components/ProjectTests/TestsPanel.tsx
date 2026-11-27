import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
  Minus,
  Play,
  RefreshCw,
  ScrollText,
  X,
} from 'lucide-react';
import '../../i18n/testsCatalog';
import type { ProjectTestCaseStatus, ProjectTestScope } from '../../../shared/projectTests';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectTestStore, isCurrentFailure, isProjectTestRunFailure, opensInEditor, type ProjectTestDisplayCase, type ProjectTestBinding } from '../../stores/projectTestStore';
import { cn } from '../../utils/cn';
import { formatWholeDuration } from '../../utils/latencyScale';
import { tallyTests, type TestTally } from '../FileTree/fileTreeMarks';
import { openTestFailure } from './openTestFailure';
import { countByStatus, type TestStatusCounts } from './testsMeterModel';
import './projectTests.css';

const MAX_RECENTS = 3;

const FILE_DOT: Record<TestTally['tone'], string> = {
  failed: 'bg-error-fg',
  passed: 'bg-success-fg',
  pending: 'bg-fg-subtle',
};

interface FileGroup {
  file: string;
  cases: ProjectTestDisplayCase[];
  counts: TestStatusCounts;
}

function groupByFile(cases: readonly ProjectTestDisplayCase[]): FileGroup[] {
  const groups = new Map<string, ProjectTestDisplayCase[]>();
  for (const entry of cases) {
    const group = groups.get(entry.file);
    if (group) group.push(entry);
    else groups.set(entry.file, [entry]);
  }
  return [...groups].map(([file, entries]) => ({ file, cases: entries, counts: countByStatus(entries) }));
}

const caseKey = (entry: Pick<ProjectTestDisplayCase, 'file' | 'path'>) => `${entry.file}\u0000${entry.path.join('\u0000')}`;

function matchesScope(scope: ProjectTestScope | null, file: string, path?: string[]): boolean {
  if (!scope) return false;
  if (scope.kind === 'all') return true;
  if (scope.file !== file) return false;
  return scope.kind === 'file' || (path !== undefined && caseKey({ file, path }) === caseKey(scope));
}

function StatusIcon({ status }: { status: ProjectTestCaseStatus | 'notRun' }) {
  if (status === 'passed') return <Check size={12} className="shrink-0 text-success-fg" aria-hidden="true" />;
  if (status === 'failed') return <X size={12} className="shrink-0 text-error-fg" aria-hidden="true" />;
  return <Minus size={12} className="shrink-0 text-fg-subtle" aria-hidden="true" />;
}

/** The Tests dock tab: the detected runner, every test grouped by file, and the raw log behind the header's output toggle. */
export function TestsPanel() {
  const currentProject = useProjectStore(state => state.currentProject);
  const binding = useMemo<ProjectTestBinding | null>(
    () => (currentProject ? { rootId: currentProject.rootId, projectName: currentProject.name } : null),
    [currentProject]
  );
  return (
    <div data-testid="tests-panel" className="flex h-full min-h-0 flex-col bg-bg-panel text-body-sm">
      {binding ? <ProjectTests binding={binding} /> : <NoProject />}
    </div>
  );
}

function NoProject() {
  const { t } = useTranslation();
  const recents = useProjectStore(state => state.recentProjects).slice(0, MAX_RECENTS);
  const openProject = useProjectStore(state => state.openProject);
  return (
    <div className="m-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-6 text-center">
      <h2 className="text-body font-semibold text-fg-base">{t('projectTests.empty.noProject.title')}</h2>
      <button type="button" className="button-primary inline-flex items-center gap-2" onClick={() => void openProject()} data-testid="tests-open-project">
        <FolderOpen size={14} aria-hidden="true" />
        {t('projectTests.empty.noProject.action')}
      </button>
      {recents.length > 0 ? (
        <section aria-label={t('projectTests.recents.label')} className="w-full">
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle text-left">
            {recents.map(project => (
              <li key={project.id} className="flex items-center gap-3 px-3 py-2" data-testid="tests-recent-project">
                <span className="min-w-0 flex-1 truncate font-medium text-fg-base" title={project.rootPath}>
                  {project.name}
                </span>
                {project.testRunner ? (
                  <span className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 font-mono text-micro text-fg-muted">
                    {t(`projectTests.framework.${project.testRunner}`)}
                  </span>
                ) : null}
                <button type="button" className="button-secondary h-7 shrink-0 px-2.5 text-caption" onClick={() => void openProject(project.rootPath)}>
                  {t('projectTests.recents.open')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ProjectTests({ binding }: { binding: ProjectTestBinding }) {
  const { t } = useTranslation();
  const rootId = useProjectTestStore(state => state.rootId);
  const status = useProjectTestStore(state => state.status);
  const detection = useProjectTestStore(state => state.detection);
  const error = useProjectTestStore(state => state.error);
  const detect = useProjectTestStore(state => state.detect);

  useEffect(() => {
    if (rootId !== binding.rootId) void detect(binding);
  }, [binding, detect, rootId]);

  if (status === 'detecting' || rootId !== binding.rootId) {
    return (
      <div role="status" className="m-auto flex items-center gap-2 text-fg-subtle">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        {t('projectTests.detecting')}
      </div>
    );
  }
  if (error === 'detect-failed') {
    return (
      <div className="m-auto flex max-w-md flex-col items-center gap-2 px-4 text-center">
        <h2 className="text-body font-semibold text-fg-base">{t('projectTests.error.detect-failed.title')}</h2>
        <p className="text-fg-subtle">{t('projectTests.error.detect-failed.description')}</p>
        <button type="button" className="button-secondary" onClick={() => void detect(binding)}>
          {t('projectTests.retry')}
        </button>
      </div>
    );
  }
  if (!detection || detection.kind === 'none') {
    return (
      <div className="m-auto flex max-w-md flex-col items-center gap-2 px-4 text-center">
        <h2 className="text-body font-semibold text-fg-base">{t('projectTests.empty.none.title')}</h2>
        <p className="text-fg-subtle">{t('projectTests.empty.none.description')}</p>
        <button type="button" className="button-secondary" onClick={() => void detect(binding)}>
          {t('projectTests.refresh')}
        </button>
      </div>
    );
  }
  return <TestResults binding={binding} />;
}

function TestResults({ binding }: { binding: ProjectTestBinding }) {
  const { t } = useTranslation();
  const status = useProjectTestStore(state => state.status);
  const detection = useProjectTestStore(state => state.detection);
  const selectedFramework = useProjectTestStore(state => state.selectedFramework);
  const selectFramework = useProjectTestStore(state => state.selectFramework);
  const cases = useProjectTestStore(state => state.cases);
  const casesTruncated = useProjectTestStore(state => state.casesTruncated);
  const result = useProjectTestStore(state => state.result);
  const error = useProjectTestStore(state => state.error);
  const filter = useProjectTestStore(state => state.filter);
  const runningScope = useProjectTestStore(state => state.runningScope);
  const liveOutput = useProjectTestStore(state => state.liveOutput);
  const run = useProjectTestStore(state => state.run);
  const detect = useProjectTestStore(state => state.detect);
  // Files the user opened or closed; the rest follow the run (with a failure, only failing files open).
  const [openChoice, setOpenChoice] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [selected, setSelected] = useState<string | null>(null);
  // A located failure whose file could not be opened keeps its message in the list.
  const [unopened, setUnopened] = useState<string | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);

  const running = status === 'running';
  const candidates = detection?.candidates ?? [];
  const candidate = candidates.find(entry => entry.framework === selectedFramework);
  const canRun = Boolean(candidate?.available) && !running;
  const groups = useMemo(() => groupByFile(cases ?? []), [cases]);
  const tallies = useMemo(() => tallyTests(cases ?? []).byFile, [cases]);
  const visibleGroups = filter === 'failed' ? groups.filter(group => group.counts.failed > 0) : groups;
  const noReport = result !== null && result.cases === undefined && (result.kind === 'success' || result.kind === 'failed');
  // A compile error fails the run before any test reports, so the log is the only answer.
  const noCases = result?.kind === 'failed' && result.cases !== undefined && result.cases.length === 0;
  const runFailure = result?.kind === 'failed' && result.cases?.some(isProjectTestRunFailure);
  const notice = result && !['success', 'failed'].includes(result.kind) ? result.kind : null;
  const output = running ? (liveOutput.transcript?.text ?? '') : (result?.orderedOutput ?? [result?.stdout, result?.stderr].filter(Boolean).join('\n'));
  const showOutput = outputOpen || noReport || noCases || runFailure;
  const outputLabel = t(showOutput ? 'projectTests.output.hide' : 'projectTests.output.show');

  const runScope = (scope: ProjectTestScope) => void run(binding, scope);
  const anyFailure = groups.some(group => tallies.get(group.file)?.tone === 'failed');
  const isOpen = (group: FileGroup) =>
    openChoice.get(group.file) ?? (!anyFailure || tallies.get(group.file)?.tone === 'failed');
  const toggleGroup = (group: FileGroup) =>
    setOpenChoice(previous => new Map(previous).set(group.file, !isOpen(group)));

  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-2 px-4" data-testid="tests-summary">
        <h3 className="min-w-0 flex-1 truncate text-eyebrow font-semibold uppercase tracking-[0.09em] text-fg-subtle">
          {t('projectTests.list.label')}
        </h3>
        {candidates.length > 1 ? (
          <select
            aria-label={t('projectTests.runner.label')}
            value={selectedFramework ?? ''}
            disabled={running}
            onChange={event => selectFramework(event.target.value as typeof candidates[number]['framework'])}
            className="h-6 rounded-md border border-border-subtle bg-bg-inset px-1.5 text-caption font-medium text-fg-base"
            data-testid="tests-runner"
          >
            {candidates.map(entry => (
              <option key={entry.framework} value={entry.framework}>
                {t(`projectTests.framework.${entry.framework}`)}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          aria-expanded={showOutput}
          aria-controls="tests-output"
          aria-label={outputLabel}
          title={outputLabel}
          onClick={() => setOutputOpen(open => !open)}
          data-testid="tests-output-toggle"
          className={cn('icon-button h-6 w-6 rounded-md', showOutput && 'bg-bg-inset text-fg-base')}
        >
          <ScrollText size={12} aria-hidden="true" />
        </button>
        {running ? (
          <Loader2 size={13} className="animate-spin text-fg-subtle" aria-hidden="true" />
        ) : (
          <button
            type="button"
            aria-label={t('projectTests.refresh')}
            title={t('projectTests.refresh')}
            onClick={() => void detect(binding)}
            data-testid="tests-refresh"
            className="icon-button h-6 w-6 rounded-md"
          >
            <RefreshCw size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      {candidate && !candidate.available && candidate.unavailableReason ? (
        <p className="flex items-start gap-2 border-b border-border-subtle bg-warning-bg/50 px-4 py-2 text-warning-fg" data-testid="tests-unavailable">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t(`projectTests.unavailable.${candidate.unavailableReason}`)}
        </p>
      ) : null}
      {notice || error === 'run-failed' || noReport || noCases || runFailure || casesTruncated ? (
        <p className="flex items-start gap-2 border-b border-border-subtle px-4 py-2 text-fg-muted" data-testid="tests-notice">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning-fg" aria-hidden="true" />
          {error === 'run-failed'
            ? t('projectTests.error.run-failed.title')
            : notice
              ? [t(`projectTests.result.${notice}`), notice === 'unavailable' && result?.unavailableReason ? t(`projectTests.unavailable.${result.unavailableReason}`) : '']
                  .filter(Boolean)
                  .join(' · ')
              : runFailure
                ? t('projectTests.runFailure')
              : noReport
                ? t('projectTests.noReport')
                : noCases
                  ? t('projectTests.noCases')
                  : t('projectTests.truncated', { count: cases?.length ?? 0 })}
        </p>
      ) : null}

      <div role="tree" aria-label={t('projectTests.list.label')} className="min-h-0 flex-1 overflow-y-auto" data-testid="tests-list">
        {visibleGroups.length === 0 ? (
          <p className="px-4 py-6 text-center text-fg-subtle">
            {cases && cases.length > 0 ? t('projectTests.noFailures') : t('projectTests.noResults')}
          </p>
        ) : (
          visibleGroups.map(group => {
            const open = isOpen(group);
            const visibleCases = filter === 'failed' ? group.cases.filter(isCurrentFailure) : group.cases;
            const fileRunning = running && matchesScope(runningScope, group.file);
            const tally = tallies.get(group.file);
            return (
              <div key={group.file} role="treeitem" aria-level={1} aria-expanded={open} aria-selected={false} data-testid="tests-file">
                <div className="group/file flex h-7 items-center gap-2 border-b border-border-subtle px-4">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className="focus-ring flex min-w-0 items-center gap-2 text-left"
                  >
                    {open ? <ChevronDown size={11} className="shrink-0 text-fg-subtle" aria-hidden="true" /> : <ChevronRight size={11} className="shrink-0 text-fg-subtle" aria-hidden="true" />}
                    <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', FILE_DOT[tally?.tone ?? 'pending'])} />
                    <span className="truncate font-mono text-caption font-medium text-fg-base">{group.file}</span>
                    <span className="sr-only">
                      {(['failed', 'passed', 'skipped', 'notRun'] as const)
                        .filter(status => group.counts[status] > 0)
                        .map(status => t(`projectTests.${status}`, { count: group.counts[status] }))
                        .join(' · ')}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!canRun}
                    onClick={() => runScope({ kind: 'file', file: group.file })}
                    data-testid="tests-run-file"
                    className="test-answer-chip opacity-0 focus:opacity-100 group-hover/file:opacity-100"
                  >
                    <Play size={9} fill="currentColor" aria-hidden="true" />
                    {t('projectTests.runFile')}
                  </button>
                  <span className="flex-1" />
                  {fileRunning ? <Loader2 size={13} className="animate-spin text-fg-subtle" aria-hidden="true" /> : null}
                  {tally && tally.total > 0 ? (
                    <span aria-hidden data-testid="tests-file-tally" className="shrink-0 font-mono text-[11.5px] tabular-nums text-fg-muted">
                      {tally.passed} / {tally.total}
                    </span>
                  ) : null}
                </div>
                {open ? (
                  <div role="group">
                    {visibleCases.map(entry => {
                      const key = caseKey(entry);
                      const isSelected = selected === key;
                      const caseRunning = running && matchesScope(runningScope, entry.file, entry.path);
                      const failedNow = isCurrentFailure(entry);
                      return (
                        <div
                          key={key}
                          role="treeitem"
                          aria-level={2}
                          aria-selected={isSelected}
                          data-testid="tests-case"
                          data-status={entry.stale ? 'not-run' : entry.status}
                          className={cn('group/case', isSelected ? 'bg-accent-tint' : 'hover:bg-bg-panel-alt')}
                        >
                          <div className="flex min-h-[26px] items-center gap-2 py-0.5 pl-9 pr-4">
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  if (opensInEditor(entry)) {
                                    setSelected(key);
                                    setUnopened(null);
                                    void openTestFailure(entry).then(opened => {
                                      if (!opened) setUnopened(key);
                                    });
                                  } else setSelected(isSelected ? null : key);
                                }}
                                className="focus-ring flex min-w-0 items-center gap-2 text-left">
                                <span className={cn('flex shrink-0', entry.stale && 'opacity-50')}><StatusIcon status={entry.status} /></span>
                                <span className={cn('truncate', failedNow ? 'text-error-fg' : 'text-fg-base', isSelected && 'font-medium')}>
                                  {entry.path.length > 0 ? (
                                    <>
                                      {entry.path.length > 1 ? <span className="text-fg-subtle">{entry.path.slice(0, -1).join(' › ')} › </span> : null}
                                      {entry.path[entry.path.length - 1]}
                                    </>
                                  ) : (
                                    t('projectTests.fileFailed')
                                  )}
                                </span>
                                {entry.stale ? <span className="shrink-0 text-fg-subtle">{t('projectTests.previousResult')}</span> : null}
                                {failedNow && entry.failureLine && entry.failureFile === entry.file ? (
                                  <span className="test-answer-chip">{t('projectTests.failedAt', { line: entry.failureLine })}</span>
                                ) : null}
                              </button>
                              {entry.runnable !== false && entry.path.length > 0 ? (
                                <button
                                  type="button"
                                  disabled={!canRun}
                                  onClick={() => runScope({ kind: 'test', file: entry.file, path: entry.path })}
                                  data-testid="tests-run-test"
                                  className={cn('test-answer-chip', !failedNow && 'opacity-0 focus:opacity-100 group-hover/case:opacity-100')}
                                >
                                  <Play size={9} fill="currentColor" aria-hidden="true" />
                                  {t('projectTests.runTest')}
                                </button>
                              ) : null}
                            </div>
                            {caseRunning ? <Loader2 size={13} className="animate-spin text-fg-subtle" aria-hidden="true" /> : null}
                            {entry.durationMs !== undefined && !entry.stale ? (
                              <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-fg-muted">{formatWholeDuration(entry.durationMs)}</span>
                            ) : null}
                          </div>
                          {isSelected && entry.failureMessage && (!opensInEditor(entry) || unopened === key) ? (
                            <pre className="mx-4 mb-2 ml-9 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-bg-inset p-2 font-mono text-micro text-fg-base" data-testid="tests-failure">
                              {entry.failureMessage}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {showOutput ? (
        <pre
          id="tests-output"
          data-testid="tests-output"
          className="max-h-[45%] min-h-0 shrink-0 overflow-auto whitespace-pre-wrap break-words border-t border-border-subtle bg-bg-inset px-4 py-2 font-mono text-micro text-fg-base"
        >
          {output || t('projectTests.output.empty')}
        </pre>
      ) : null}
    </>
  );
}
