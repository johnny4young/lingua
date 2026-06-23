/**
 * RL-112 — persistent 24px bottom status bar.
 *
 * A fixed-height flex strip mounted at the bottom of the app shell. Folds in
 * the project Git branch chip (A), a display-only encoding segment (B), the
 * focus-from-palette affordance (C), click-to-next-problem on the lint segment
 * (D), the toggle telemetry (E, in the store setter), the compact run-status
 * pill (F), and a per-model indent cycle (G). Fully unmounts when the
 * `showStatusBar` setting is OFF (default OFF web / ON desktop).
 *
 * Each segment is a focusable control with an `aria-label` + `data-testid`.
 * The Git segment self-hides when no posture is available; the cursor segment
 * renders a placeholder when no editor is focused. Mutations (language cycle,
 * indent cycle, next problem) drive the active editor / stores directly — the
 * bar reads, it does not own state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_PACKS } from '../../../shared/languagePacks';
import { languageLabel } from '../../utils/languageMeta';
import { getActiveEditor } from '../../runtime/editorAccess';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useEditorStore } from '../../stores/editorStore';
import { useGitStore } from '../../stores/gitStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Language } from '../../types';
import { cn } from '../../utils/cn';
import { RunStatusPill } from '../Editor/RunStatusPill';
import { setStatusBarFocuser } from './statusBarAccess';
import { useStatusBarModel } from './useStatusBarModel';

/**
 * RL-112 — the runnable-language cycle for the language segment. Same filter as
 * the Toolbar's new-file menu (`execution` is run/compile AND the pack ships
 * starter templates), so clicking the segment cycles through the exact set the
 * Toolbar offers, in declaration order.
 */
const CYCLEABLE_LANGUAGES: readonly Language[] = LANGUAGE_PACKS.filter(
  (pack) =>
    (pack.execution === 'run' || pack.execution === 'compile') &&
    pack.templateIds.length > 0
).map((pack) => pack.id as Language);

/** RL-112 fold G — the indent cycle: spaces-2 → spaces-4 → tabs-4 → (wrap). */
interface IndentConfig {
  insertSpaces: boolean;
  tabSize: number;
}
const INDENT_SPACES_2: IndentConfig = { insertSpaces: true, tabSize: 2 };
const INDENT_CYCLE: readonly IndentConfig[] = [
  INDENT_SPACES_2,
  { insertSpaces: true, tabSize: 4 },
  { insertSpaces: false, tabSize: 4 },
];

function nextIndent(current: IndentConfig): IndentConfig {
  const index = INDENT_CYCLE.findIndex(
    (entry) =>
      entry.insertSpaces === current.insertSpaces &&
      entry.tabSize === current.tabSize
  );
  // Unknown current config (e.g. tabs-2) folds back to the start of the cycle.
  const nextIndex = index === -1 ? 0 : (index + 1) % INDENT_CYCLE.length;
  return INDENT_CYCLE[nextIndex] ?? INDENT_SPACES_2;
}

const SEGMENT_CLASS =
  'flex h-full items-center gap-1 border-l border-border/60 px-2 text-fg-muted ' +
  'hover:text-fg-base focus-visible:outline-none focus-visible:text-fg-base';

export function StatusBar() {
  const showStatusBar = useSettingsStore((state) => state.showStatusBar);
  if (!showStatusBar) return null;
  return <StatusBarContent />;
}

function StatusBarContent() {
  const { t } = useTranslation();
  const model = useStatusBarModel();
  const posture = useGitStore((state) => state.posture);
  const activeTab = useActiveTab();
  const activeTabId = activeTab?.id ?? null;
  const activeLanguage = activeTab?.language;
  const setTabLanguage = useEditorStore((state) => state.setTabLanguage);

  const firstSegmentRef = useRef<HTMLButtonElement | null>(null);
  // RL-112 fold G — a render bump so the indent segment reflects the new model
  // options immediately after a click (Monaco's `updateOptions` does not fire a
  // cursor-change event the model hook would otherwise key off).
  const [, setIndentBump] = useState(0);

  // RL-112 fold C — register a focuser that moves keyboard focus to the first
  // segment button. Cleared on unmount so a stale closure never fires.
  useEffect(() => {
    setStatusBarFocuser(() => firstSegmentRef.current?.focus());
    return () => setStatusBarFocuser(null);
  }, []);

  const cycleLanguage = useCallback(() => {
    if (!activeTabId || !activeLanguage) return;
    const index = CYCLEABLE_LANGUAGES.indexOf(activeLanguage);
    const next =
      CYCLEABLE_LANGUAGES[(index + 1) % CYCLEABLE_LANGUAGES.length] ??
      CYCLEABLE_LANGUAGES[0];
    if (next) setTabLanguage(activeTabId, next);
  }, [activeTabId, activeLanguage, setTabLanguage]);

  const focusNextProblem = useCallback(() => {
    getActiveEditor()?.trigger(
      'lingua-status-bar',
      'editor.action.marker.next',
      {}
    );
  }, []);

  const cycleIndent = useCallback(() => {
    const editorModel = getActiveEditor()?.getModel();
    if (!editorModel) return;
    const options = editorModel.getOptions();
    const next = nextIndent({
      insertSpaces: options.insertSpaces,
      tabSize: options.tabSize,
    });
    editorModel.updateOptions(next);
    // Force the segment to re-read the model options on this same tick.
    setIndentBump((value) => value + 1);
  }, []);

  // RL-112 fold G — read indent live from the model so the click-driven bump
  // surfaces the new value even before the model hook re-fires.
  const liveIndent = getActiveEditor()?.getModel()?.getOptions() ?? null;
  const indent = liveIndent
    ? { insertSpaces: liveIndent.insertSpaces, tabSize: liveIndent.tabSize }
    : model.indent;

  const lintClean = model.lintErrors + model.lintWarnings === 0;
  const lintLabel = lintClean
    ? t('statusBar.lint.clean')
    : `${t('statusBar.lint.errors', { count: model.lintErrors })}, ${t('statusBar.lint.warnings', { count: model.lintWarnings })}`;

  const languageDisplay = activeLanguage ? languageLabel(activeLanguage) : '';
  const gitBranchLabel =
    posture?.branch ?? t('editor.git.tooltip.detachedHead');
  const gitTooltip = posture?.commit
    ? `${gitBranchLabel} · ${posture.commit.slice(0, 7)}`
    : gitBranchLabel;

  return (
    <div
      data-testid="status-bar"
      className="flex h-6 shrink-0 items-stretch border-t border-border bg-bg-base text-caption"
    >
      {/* 1 — Language (click cycles the active tab's language). */}
      <button
        ref={firstSegmentRef}
        type="button"
        data-testid="status-bar-language"
        className={cn(SEGMENT_CLASS, '!border-l-0')}
        title={t('statusBar.language.tooltip', { language: languageDisplay })}
        aria-label={t('statusBar.language.tooltip', {
          language: languageDisplay,
        })}
        onClick={cycleLanguage}
        disabled={!activeTabId}
      >
        {languageDisplay}
      </button>

      {/* 2 — Lint (click jumps to the next problem). */}
      <button
        type="button"
        data-testid="status-bar-lint"
        data-lint-errors={model.lintErrors}
        data-lint-warnings={model.lintWarnings}
        className={SEGMENT_CLASS}
        title={lintLabel}
        aria-label={lintLabel}
        onClick={focusNextProblem}
      >
        {lintLabel}
      </button>

      {/* 3 — Cursor position. */}
      <button
        type="button"
        data-testid="status-bar-cursor"
        className={SEGMENT_CLASS}
        title={
          model.cursor
            ? t('statusBar.cursor', {
                line: model.cursor.line,
                column: model.cursor.column,
              })
            : undefined
        }
        aria-label={
          model.cursor
            ? t('statusBar.cursor', {
                line: model.cursor.line,
                column: model.cursor.column,
              })
            : t('statusBar.cursor', { line: '—', column: '—' })
        }
      >
        {model.cursor
          ? t('statusBar.cursor', {
              line: model.cursor.line,
              column: model.cursor.column,
            })
          : t('statusBar.cursor', { line: '—', column: '—' })}
      </button>

      {/* 4 — Encoding (fold B): display-only but still keyboard-focusable. */}
      <button
        type="button"
        data-testid="status-bar-encoding"
        className={cn(SEGMENT_CLASS, 'cursor-default')}
        title={t('statusBar.encoding')}
        aria-label={t('statusBar.encoding')}
      >
        {t('statusBar.encoding')}
      </button>

      {/* 5 — Indent (fold G): click cycles the active model's indentation. */}
      <button
        type="button"
        data-testid="status-bar-indent"
        className={SEGMENT_CLASS}
        title={
          indent
            ? indent.insertSpaces
              ? t('statusBar.indent.spaces', { width: indent.tabSize })
              : t('statusBar.indent.tabs', { width: indent.tabSize })
            : undefined
        }
        aria-label={
          indent
            ? indent.insertSpaces
              ? t('statusBar.indent.spaces', { width: indent.tabSize })
              : t('statusBar.indent.tabs', { width: indent.tabSize })
            : t('statusBar.indent.spaces', { width: '—' })
        }
        onClick={cycleIndent}
        disabled={!indent}
      >
        {indent
          ? indent.insertSpaces
            ? t('statusBar.indent.spaces', { width: indent.tabSize })
            : t('statusBar.indent.tabs', { width: indent.tabSize })
          : null}
      </button>

      {/* 6 — Git branch (fold A): self-hides when no posture is available. */}
      {posture?.available ? (
        <button
          type="button"
          data-testid="status-bar-git"
          data-git-branch={posture.branch ?? null}
          className={cn(SEGMENT_CLASS, 'cursor-default')}
          title={gitTooltip}
          aria-label={gitTooltip}
        >
          <GitBranch size={11} aria-hidden="true" className="opacity-70" />
          <span className="max-w-[160px] truncate">{gitBranchLabel}</span>
        </button>
      ) : null}

      {/* 7 — Run status (fold F): compact icon-only pill, pushed right. */}
      <button
        type="button"
        data-testid="status-bar-run"
        className="ml-auto flex h-full items-center border-l border-border/60 px-2 text-fg-muted focus-visible:outline-none focus-visible:text-fg-base"
        title={t('statusBar.run.tooltip')}
        aria-label={t('statusBar.run.tooltip')}
      >
        <RunStatusPill compact />
      </button>
    </div>
  );
}
