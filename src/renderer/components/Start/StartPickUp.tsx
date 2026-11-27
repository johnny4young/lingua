import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder } from 'lucide-react';
import { getSessionTabAnswers, projectLastAnswer, type SessionTabAnswer } from '../../stores/lastAnswerSelectors';
import { useProjectStore, type RecentProject } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import type { LastAnswer } from '../../utils/lastAnswer';
import { languageLabel } from '../../utils/languageMeta';
import { formatRunDuration } from '../../utils/timeLabels';
import { AnswerPicture } from './AnswerPicture';
import { LanguageSquare, SectionHeading } from './StartParts';
import { DotLeader } from '../ui/answer';
import { answerDisplay, answerIdentity } from './answerLabels';
import { startTimeAgo } from './startModel';

const MAX_ROWS = 9;

interface PickUpRow {
  key: string;
  badge: ReactNode;
  name: string;
  detail?: string;
  answer: LastAnswer;
  reopen: () => void;
}

function reopenTab(index: number): void {
  void useSessionStore.getState().restoreSession({ only: index });
}

function tabRow(tab: SessionTabAnswer, t: (key: string) => string): PickUpRow {
  const { lastAnswer } = tab;
  const { badge: badgeLanguage, name, workspace } = answerIdentity(tab, lastAnswer);
  const detail = workspace
    ? lastAnswer.context
    : tab.filePath
      ? languageLabel(tab.language)
      : `${t('start.pickUp.scratch')} · ${languageLabel(tab.language)}`;
  return {
    key: `tab-${tab.index}`,
    badge: <LanguageSquare language={badgeLanguage} />,
    name,
    ...(detail ? { detail } : {}),
    answer: lastAnswer,
    reopen: () => reopenTab(tab.index),
  };
}

function projectRow(project: RecentProject, answer: LastAnswer, t: (key: string) => string): PickUpRow {
  const runner = project.testRunner ? ` · ${t(`projectTests.framework.${project.testRunner}`)}` : '';
  return {
    key: `project-${project.id}`,
    badge: (
      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-bg-panel-alt text-fg-muted" aria-hidden>
        <Folder size={13} />
      </span>
    ),
    name: project.name,
    detail: `${t('start.pickUp.folder')}${runner}`,
    answer,
    reopen: () => void useProjectStore.getState().openProject(project.rootPath),
  };
}

function AnswerValue({ answer }: { answer: LastAnswer }) {
  const { t } = useTranslation();
  const { value, unit, failed } = answerDisplay(answer, t);
  return (
    <span className="start-answer flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
      <span
        className="start-numeral min-w-0 truncate font-display tracking-[-0.02em]"
        data-empty={answer.numeral ? undefined : ''}
        data-failed={failed ? '' : undefined}
      >
        {value}
      </span>
      {unit ? <span className="start-unit shrink-0 font-display italic text-fg-muted">{unit}</span> : null}
    </span>
  );
}

function AnswerDetail({ answer }: { answer: LastAnswer }) {
  const { t } = useTranslation();
  const duration = answer.durationMs === undefined ? undefined : formatRunDuration(answer.durationMs);
  const secondary = answer.kind === 'tests' ? answer.subject : duration;
  const delta = answer.picture ? undefined : answer.deltaMs;
  return (
    <span className="start-detail shrink-0 items-center gap-2">
      {answer.picture ? <AnswerPicture picture={answer.picture} /> : null}
      {secondary ? <span className="start-small truncate font-mono text-fg-muted">{secondary}</span> : null}
      {delta ? (
        <span
          className="start-delta inline-flex shrink-0 items-center rounded-md border border-dashed border-border-strong px-1.5 font-mono font-semibold text-fg-muted"
          aria-label={t(delta < 0 ? 'start.answer.faster' : 'start.answer.slower', {
            duration: formatRunDuration(Math.abs(delta)),
          })}
          role="img"
        >
          {delta < 0 ? '▼' : '▲'} {formatRunDuration(Math.abs(delta))}
        </span>
      ) : null}
    </span>
  );
}

/** Last session's tabs, and the last tested folder, each with the answer it left. */
export function StartPickUp() {
  const { t, i18n } = useTranslation();
  const recentProjects = useProjectStore(state => state.recentProjects);
  const hasProject = useProjectStore(state => state.currentProject !== null);
  // Only the session the restore prompt pinned is a last session; autosave never rewrites it.
  const pendingTabs = useSessionStore(state => state.pendingRestoreTabs);
  // Ages read from when Start opened; Start unmounts as soon as a tab opens.
  const [now] = useState(Date.now);

  const { rows, tested, sessionCount } = useMemo(() => {
    let tested: RecentProject | undefined;
    let testedAnswer: LastAnswer | undefined;
    for (const project of hasProject ? [] : recentProjects) {
      testedAnswer = projectLastAnswer(project);
      if (testedAnswer) {
        tested = project;
        break;
      }
    }
    const project = tested && testedAnswer ? [projectRow(tested, testedAnswer, t)] : [];
    const answered = pendingTabs > 0 ? getSessionTabAnswers() : [];
    const tabs = answered.slice(0, MAX_ROWS - project.length).map(tab => tabRow(tab, t));
    return { rows: [...tabs, ...project], tested, sessionCount: pendingTabs + project.length };
  }, [pendingTabs, recentProjects, hasProject, t]);

  // Digits reopen a row while nothing else holds the keyboard.
  useEffect(() => {
    if (rows.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (document.activeElement && document.activeElement !== document.body) {
        if (!document.activeElement.closest('[data-testid="start-page"]')) return;
        if (document.activeElement.closest('input, textarea, [contenteditable="true"], .monaco-editor')) return;
      }
      const row = rows[Number(event.key) - 1];
      if (!/^[1-9]$/.test(event.key) || !row) return;
      event.preventDefault();
      row.reopen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rows]);

  if (rows.length === 0) return null;

  const reopenAll = () => {
    void useSessionStore.getState().restoreSession();
    if (tested) void useProjectStore.getState().openProject(tested.rootPath);
  };

  return (
    <section className="start-section-first" aria-labelledby="start-pick-up-title" data-testid="start-pick-up">
      <SectionHeading
        id="start-pick-up-title"
        title={t('start.pickUp.title')}
        detail={t('start.pickUp.count', { count: rows.length })}
        action={
          <button
            type="button"
            onClick={reopenAll}
            className="rounded-md px-1 text-[12.5px] text-fg-muted transition-colors hover:text-fg-base focus-ring"
            data-testid="start-reopen-all"
          >
            {t('start.pickUp.reopenAll', { count: sessionCount })}
          </button>
        }
      />
      <ol className="start-rule">
        {rows.map((row, index) => (
          <li key={row.key} className="border-t border-border-subtle first:border-t-0">
            <button
              type="button"
              onClick={row.reopen}
              aria-label={t('start.pickUp.reopen', { name: row.name })}
              aria-keyshortcuts={String(index + 1)}
              className="start-row group flex w-full min-w-0 items-center gap-3 whitespace-nowrap rounded-md px-1 text-left transition-colors hover:bg-bg-panel-alt/60 focus-ring"
              data-testid={`start-pick-up-row-${index + 1}`}
            >
              <span className="start-row-head">
                <span
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-border-strong font-mono text-[11px] text-fg-muted"
                  aria-hidden
                >
                  {index + 1}
                </span>
                {row.badge}
                <span
                  className="start-row-name truncate font-mono font-semibold text-fg-base"
                  // Monospace, so a name holds its full width up to 12 characters before it truncates.
                  style={{ '--start-name-min': `${Math.min([...row.name].length, 12)}ch` } as CSSProperties}
                  title={row.name}
                >
                  {row.name}
                </span>
                {row.detail ? (
                  <span className="start-row-detail min-w-0 truncate text-[12.5px] text-fg-muted" title={row.detail}>
                    {row.detail}
                  </span>
                ) : null}
              </span>
              <span className="start-row-tail">
                <DotLeader />
                <AnswerValue answer={row.answer} />
                <AnswerDetail answer={row.answer} />
                <span className="start-row-age shrink-0 text-right text-[12.5px] text-fg-muted">
                  {startTimeAgo(row.answer.ranAt, now, i18n.language)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
