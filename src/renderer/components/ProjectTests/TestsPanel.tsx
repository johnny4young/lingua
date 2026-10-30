import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileCode2,
  FolderOpen,
  Loader2,
  MinusCircle,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import '../../i18n/testsCatalog';
import type { ProjectTestCaseStatus, ProjectTestScope } from '../../../shared/projectTests';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectTestStore, isProjectTestRunFailure, type ProjectTestDisplayCase, type ProjectTestBinding } from '../../stores/projectTestStore';
import { cn } from '../../utils/cn';
import { openTestFailure, opensInEditor } from './openTestFailure';

const MAX_RECENTS = 3;

interface FileGroup {
  file: string;
  cases: ProjectTestDisplayCase[];
  counts: Record<ProjectTestCaseStatus | 'notRun', number>;
}

function countByStatus(cases: readonly ProjectTestDisplayCase[]): Record<ProjectTestCaseStatus | 'notRun', number> {
  const counts = { passed: 0, failed: 0, skipped: 0, notRun: 0 };
  for (const entry of cases) counts[entry.stale ? 'notRun' : entry.status] += 1;
  return counts;
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
  if (status === 'passed') return <CheckCircle2 size={14} className="shrink-0 text-success-fg" aria-hidden="true" />;
  if (status === 'failed') return <XCircle size={14} className="shrink-0 text-error-fg" aria-hidden="true" />;
  return <MinusCircle size={14} className="shrink-0 text-fg-subtle" aria-hidden="true" />;
}

/** The Tests dock tab: the detected runner, every test grouped by file, and the raw log behind Show output. */
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
  const setFilter = useProjectTestStore(state => state.setFilter);
  const runningScope = useProjectTestStore(state => state.runningScope);
  const liveOutput = useProjectTestStore(state => state.liveOutput);
  const run = useProjectTestStore(state => state.run);
  const stop = useProjectTestStore(state => state.stop);
  const detect = useProjectTestStore(state => state.detect);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);

  const running = status === 'running';
  const candidates = detection?.candidates ?? [];
  const candidate = candidates.find(entry => entry.framework === selectedFramework);
  const canRun = Boolean(candidate?.available) && !running;
  const groups = useMemo(() => groupByFile(cases ?? []), [cases]);
  const counts = useMemo(() => countByStatus(cases ?? []), [cases]);
  const visibleGroups = filter === 'failed' ? groups.filter(group => group.counts.failed > 0) : groups;
  const noReport = result !== null && result.cases === undefined && (result.kind === 'success' || result.kind === 'failed');
  // A compile error fails the run before any test reports, so the log is the only answer.
  const noCases = result?.kind === 'failed' && result.cases !== undefined && result.cases.length === 0;
  const runFailure = result?.kind === 'failed' && result.cases?.some(isProjectTestRunFailure);
  const notice = result && !['success', 'failed'].includes(result.kind) ? result.kind : null;
  const output = running ? (liveOutput.transcript?.text ?? '') : (result?.orderedOutput ?? [result?.stdout, result?.stderr].filter(Boolean).join('\n'));
  const showOutput = outputOpen || noReport || noCases || runFailure;

  const runScope = (scope: ProjectTestScope) => void run(binding, scope);
  const toggleGroup = (file: string) =>
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });

  return (
    <>
      <div className="flex min-h-[54px] shrink-0 flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border-subtle px-4 py-2">
        {running ? (
          <button type="button" className="button-danger inline-flex h-[34px] items-center gap-2 px-4" onClick={() => void stop(binding)} data-testid="tests-stop">
            <CircleStop size={13} aria-hidden="true" />
            {t('projectTests.stop')}
          </button>
        ) : (
          <button type="button" className="button-primary inline-flex h-[34px] items-center gap-2 px-4 font-semibold" disabled={!canRun} onClick={() => runScope({ kind: 'all' })} data-testid="tests-run-all">
            <Play size={12} fill="currentColor" aria-hidden="true" />
            {t('projectTests.runAll')}
          </button>
        )}
        <span className="flex min-w-0 items-center gap-1.5 text-fg-muted" data-testid="tests-summary">
          {cases && cases.length > 0 ? (
            <span>
              {t('projectTests.summary', {
                tests: t('projectTests.count.tests', { count: cases.length }),
                files: t('projectTests.count.files', { count: groups.length }),
              })}
            </span>
          ) : null}
          {candidates.length > 1 ? (
            <select
              aria-label={t('projectTests.runner.label')}
              value={selectedFramework ?? ''}
              disabled={running}
              onChange={event => selectFramework(event.target.value as typeof candidates[number]['framework'])}
              className="h-7 rounded-md border border-border-subtle bg-bg-inset px-2 font-semibold text-fg-base"
              data-testid="tests-runner"
            >
              {candidates.map(entry => (
                <option key={entry.framework} value={entry.framework}>
                  {t(`projectTests.framework.${entry.framework}`)}
                </option>
              ))}
            </select>
          ) : selectedFramework ? (
            <span className="font-semibold text-fg-base">{t(`projectTests.framework.${selectedFramework}`)}</span>
          ) : null}
          {!running ? (
            <button
              type="button"
              aria-label={t('projectTests.refresh')}
              title={t('projectTests.refresh')}
              onClick={() => void detect(binding)}
              data-testid="tests-refresh"
              className="icon-button h-7 w-7 rounded-md"
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          ) : null}
          {running ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-fg-subtle">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              {t('projectTests.running')}
            </span>
          ) : null}
        </span>
        {cases && cases.length > 0 ? (
          <div className="ml-auto flex items-center gap-3.5">
            <span className="flex items-center gap-3.5" data-testid="tests-counts">
              <span className="inline-flex items-center gap-1.5 text-success-fg">
                <CheckCircle2 size={14} aria-hidden="true" />
                {t('projectTests.passed', { count: counts.passed })}
              </span>
              <span className={cn('inline-flex items-center gap-1.5', counts.failed > 0 ? 'text-error-fg' : 'text-fg-subtle')}>
                <XCircle size={14} aria-hidden="true" />
                {t('projectTests.failed', { count: counts.failed })}
              </span>
              {counts.skipped > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-fg-muted">
                  <MinusCircle size={14} aria-hidden="true" />
                  {t('projectTests.skipped', { count: counts.skipped })}
                </span>
              ) : null}
              {counts.notRun > 0 ? <span className="text-fg-subtle">{t('projectTests.notRun', { count: counts.notRun })}</span> : null}
            </span>
            <span className="h-[18px] w-px bg-border-subtle" aria-hidden="true" />
            <div role="radiogroup" aria-label={t('projectTests.filter.label')} className="inline-flex rounded-lg border border-border-subtle bg-bg-inset p-0.5">
              {(['all', 'failed'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={filter === option}
                  onClick={() => setFilter(option)}
                  data-testid={`tests-filter-${option}`}
                  className={cn(
                    'focus-ring h-6 rounded-md px-2.5 text-caption font-medium',
                    filter === option ? 'bg-bg-panel text-fg-base shadow-e1' : 'text-fg-muted hover:text-fg-base'
                  )}
                >
                  {t(`projectTests.filter.${option}`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
            const open = !collapsed.has(group.file);
            const visibleCases = filter === 'failed' ? group.cases.filter(entry => entry.status === 'failed' && !entry.stale) : group.cases;
            const fileRunning = running && matchesScope(runningScope, group.file);
            return (
              <div key={group.file} role="treeitem" aria-level={1} aria-expanded={open} aria-selected={false} data-testid="tests-file">
                <div className="group/file flex h-[34px] items-center gap-2.5 border-b border-border-subtle px-4">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.file)}
                    className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
                    <FileCode2 size={13} className="shrink-0 text-fg-subtle" aria-hidden="true" />
                    <span className="truncate font-mono text-caption text-fg-base">{group.file}</span>
                    {(
                      [
                        ['failed', 'text-error-fg'],
                        ['passed', group.counts.failed > 0 ? 'text-fg-subtle' : 'text-success-fg'],
                        ['skipped', 'text-fg-subtle'],
                        ['notRun', 'text-fg-subtle'],
                      ] as const
                    )
                      .filter(([status]) => group.counts[status] > 0)
                      .map(([status, tone], index) => (
                        <span key={status} className={cn('shrink-0', tone)}>
                          {index > 0 ? '· ' : ''}
                          {t(`projectTests.${status}`, { count: group.counts[status] })}
                        </span>
                      ))}
                  </button>
                  {fileRunning ? <Loader2 size={13} className="animate-spin text-fg-subtle" aria-hidden="true" /> : null}
                  <button
                    type="button"
                    disabled={!canRun}
                    onClick={() => runScope({ kind: 'file', file: group.file })}
                    data-testid="tests-run-file"
                    className="button-secondary inline-flex h-[26px] shrink-0 items-center gap-1.5 px-2 text-caption opacity-0 focus:opacity-100 group-hover/file:opacity-100"
                  >
                    <Play size={10} fill="currentColor" aria-hidden="true" />
                    {t('projectTests.runFile')}
                  </button>
                </div>
                {open ? (
                  <div role="group">
                    {visibleCases.map(entry => {
                      const key = caseKey(entry);
                      const isSelected = selected === key;
                      const caseRunning = running && matchesScope(runningScope, entry.file, entry.path);
                      return (
                        <div
                          key={key}
                          role="treeitem"
                          aria-level={2}
                          aria-selected={isSelected}
                          data-testid="tests-case"
                          data-status={entry.stale ? 'not-run' : entry.status}
                          className={cn('group/case border-b border-border-subtle', isSelected ? 'bg-accent-tint' : 'hover:bg-bg-panel-alt')}
                        >
                          <div className="flex min-h-8 items-center gap-2.5 py-1 pl-11 pr-4">
                            <button
                              type="button"
                              onClick={() => {
                                if (opensInEditor(entry)) {
                                  setSelected(key);
                                  void openTestFailure(entry);
                                } else setSelected(isSelected ? null : key);
                              }}
                              className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 text-left">
                              <span className={cn('flex shrink-0', entry.stale && 'opacity-50')}><StatusIcon status={entry.status} /></span>
                              <span className={cn('truncate text-fg-base', isSelected && 'font-medium')}>
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
                              {!entry.stale && entry.status === 'failed' && entry.failureLine && entry.failureFile === entry.file ? (
                                <span className="shrink-0 text-error-fg">{t('projectTests.failedAt', { line: entry.failureLine })}</span>
                              ) : null}
                            </button>
                            {caseRunning ? <Loader2 size={13} className="animate-spin text-fg-subtle" aria-hidden="true" /> : null}
                            {entry.runnable !== false && entry.path.length > 0 ? (
                              <button
                                type="button"
                                disabled={!canRun}
                                onClick={() => runScope({ kind: 'test', file: entry.file, path: entry.path })}
                                data-testid="tests-run-test"
                                className="button-secondary inline-flex h-[26px] shrink-0 items-center gap-1.5 px-2 text-caption opacity-0 focus:opacity-100 group-hover/case:opacity-100"
                              >
                                <Play size={10} fill="currentColor" aria-hidden="true" />
                                {t('projectTests.runTest')}
                              </button>
                            ) : null}
                          </div>
                          {isSelected && entry.failureMessage && !opensInEditor(entry) ? (
                            <pre className="mx-4 mb-2 ml-11 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-bg-inset p-2 font-mono text-micro text-fg-base" data-testid="tests-failure">
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

      <div className={cn('shrink-0 border-t border-border-subtle', showOutput && 'flex max-h-[45%] min-h-0 flex-col')}>
        <button
          type="button"
          aria-expanded={showOutput}
          onClick={() => setOutputOpen(open => !open)}
          data-testid="tests-output-toggle"
          className="focus-ring flex h-[34px] w-full shrink-0 items-center gap-2 bg-bg-panel-alt px-4 text-left text-fg-base"
        >
          {showOutput ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
          {t(showOutput ? 'projectTests.output.hide' : 'projectTests.output.show')}
        </button>
        {showOutput ? (
          <pre data-testid="tests-output" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-bg-inset px-4 py-2 font-mono text-micro text-fg-base">
            {output || t('projectTests.output.empty')}
          </pre>
        ) : null}
      </div>
    </>
  );
}
