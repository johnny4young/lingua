/**
 * implementation — "Replace in files" overlay (companion to
 * Cmd+Shift+F find-in-files).
 *
 * Layout mirrors `ProjectSearch` chrome (`OverlayBackdrop` +
 * `OverlayCard`) so users see the same shell. Adds a second
 * Replace-with input below the Find input, regex + case toggles, a
 * grouped-by-file preview with inline before/after diff, per-file
 * `Apply` buttons + a global `Apply to all` confirmation modal,
 * an `Apply queue` progress strip (implementation note), per-match diff hover
 * popover (implementation note), an `Excludes` chip strip in the header (implementation note).
 *
 * Apply dispatch (implementation note — surface open tab before apply): when a
 * replace targets a file already open in `editorStore.tabs` with a
 * matching `filePath`, the overlay switches the active tab to that
 * file FIRST so the user can observe the change. The substitution
 * always lands on disk through `fs:applyReplaceInFile`; if the file
 * is open in a tab, the overlay then re-reads the file from disk
 * and updates the tab's buffer in-place via `setTabContentFromDisk`
 * so the on-screen content matches disk. **Cmd+Z does NOT restore
 * replace-in-files changes** — this is documented in the
 * confirmation modal copy. The user-facing message is honest:
 * "Open tabs reload from disk after the change; there is no undo
 * for files that were not open." A future work may add a true
 * Monaco `executeEdits` path that preserves the per-tab undo
 * stack; that requires per-tab editor-instance access through a
 * model registry and is out of scope for this MVP.
 */

import { Search, X, RotateCcw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import {
  useProjectReplaceStore,
  type ProjectReplaceMatch,
  type ProjectReplaceResult,
} from '../../stores/projectReplaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { asRelativePath } from '../../../shared/fs/brandedIds';
import { joinAbsolute } from '../../utils/filePath';
import { Kbd, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { handleCloseOnEscape } from '../ui/keyboard';
import { trackEvent } from '../../utils/telemetry';
import { bucketDependencyCount } from '../../../shared/dependencies/types';
import { useUIStore } from '../../stores/uiStore';

const PREVIEW_DEBOUNCE_MS = 220;

/**
 * implementation note — defaults documented by the main IPC's
 * `shouldHide` predicate. Surfacing them in the overlay header as
 * muted chips prevents the "why isn't my replace finding it?"
 * confusion when the match lives inside an excluded directory.
 */
const EXCLUDE_CHIPS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
];

interface ProjectReplaceProps {
  onClose: () => void;
}

function MatchDiff({ match }: { readonly match: ProjectReplaceMatch }) {
  // implementation note — diff hover popover. The hover surface
  // renders a fuller context window (5 lines of left+right context
  // would require the IPC to return surrounding lines, deferred to
  // a follow-up; for MVP we render the full single-line preview /
  // replacedPreview side-by-side).
  return (
    <div className="group/match relative block">
      <span className="block truncate font-mono text-body-sm leading-6 text-muted">
        <span className="text-danger/80 line-through decoration-danger/40">
          {match.preview.slice(0, match.matchStart)}
          <mark className="rounded-sm bg-danger/20 px-0.5 text-foreground">
            {match.preview.slice(match.matchStart, match.matchEnd)}
          </mark>
          {match.preview.slice(match.matchEnd)}
        </span>
      </span>
      <span className="block truncate font-mono text-body-sm leading-6 text-success">
        <mark className="rounded-sm bg-success/15 px-0.5 text-foreground">
          {match.replacement}
        </mark>
        <span className="text-muted">
          {' '}
          ({match.replacedPreview.slice(0, 80)}
          {match.replacedPreview.length > 80 ? '…' : ''})
        </span>
      </span>
    </div>
  );
}

function FileRow({
  result,
  applying,
  onApply,
}: {
  readonly result: ProjectReplaceResult;
  readonly applying: boolean;
  readonly onApply: (relativePath: string) => void;
}) {
  const { t } = useTranslation();
  if (result.regexTimedOut) {
    return (
      <div
        className="border-t border-border/60 px-4 py-2 text-body-sm text-warning"
        data-testid={`project-replace-row-${result.relativePath}`}
      >
        {t('projectReplace.regexTimedOut', { path: result.relativePath })}
      </div>
    );
  }
  return (
    <div
      className="border-t border-border/60"
      data-testid={`project-replace-row-${result.relativePath}`}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="truncate font-mono text-body-sm text-foreground">
          {result.relativePath}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted">
            {t('projectReplace.matchCount', {
              count: result.matches.length,
              fileCount: 1,
            })}
          </span>
          <button
            type="button"
            disabled={applying}
            onClick={() => onApply(result.relativePath)}
            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-caption text-foreground hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid={`project-replace-apply-file-${result.relativePath}`}
          >
            {t('projectReplace.applyToFile.button')}
          </button>
        </div>
      </header>
      <ul className="px-4 pb-2">
        {result.matches.map((match) => (
          <li key={`${match.line}:${match.column}`} className="py-1">
            <MatchDiff match={match} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProjectReplace({ onClose }: ProjectReplaceProps) {
  const { t } = useTranslation();
  const findInputRef = useRef<HTMLInputElement>(null);

  const currentProject = useProjectStore((state) => state.currentProject);
  const tabs = useEditorStore((state) => state.tabs);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const setTabContentFromDisk = useEditorStore(
    (state) => state.setTabContentFromDisk
  );

  const query = useProjectReplaceStore((state) => state.query);
  const replacement = useProjectReplaceStore((state) => state.replacement);
  const regex = useProjectReplaceStore((state) => state.regex);
  const caseSensitive = useProjectReplaceStore((state) => state.caseSensitive);
  const status = useProjectReplaceStore((state) => state.status);
  const results = useProjectReplaceStore((state) => state.results);
  const totalMatches = useProjectReplaceStore((state) => state.totalMatches);
  const error = useProjectReplaceStore((state) => state.error);
  const applying = useProjectReplaceStore((state) => state.applying);
  const applyProgress = useProjectReplaceStore(
    (state) => state.applyProgress
  );
  const setQuery = useProjectReplaceStore((state) => state.setQuery);
  const setReplacement = useProjectReplaceStore(
    (state) => state.setReplacement
  );
  const setRegex = useProjectReplaceStore((state) => state.setRegex);
  const setCaseSensitive = useProjectReplaceStore(
    (state) => state.setCaseSensitive
  );
  const preview = useProjectReplaceStore((state) => state.preview);
  const applyToFileAction = useProjectReplaceStore(
    (state) => state.applyToFile
  );
  const applyToAllAction = useProjectReplaceStore(
    (state) => state.applyToAll
  );
  const clear = useProjectReplaceStore((state) => state.clear);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const pushDirtyOpenTabNotice = useCallback((relativePath: string) => {
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'projectReplace.dirtyOpenTab',
      values: { path: relativePath },
    });
  }, []);

  const openTabForRelativePath = useCallback(
    (relativePath: string) => {
      if (!currentProject) return null;
      const displayPath = joinAbsolute(
        currentProject.rootPath,
        relativePath
      );
      return tabs.find((tab) => tab.filePath === displayPath) ?? null;
    },
    [currentProject, tabs]
  );

  const refreshOpenTabFromDisk = useCallback(
    async (tabId: string, relativePath: string) => {
      if (!currentProject) return;
      try {
        const fresh = await window.lingua?.fs?.read?.(
          currentProject.rootId,
          asRelativePath(relativePath)
        );
        if (typeof fresh === 'string') {
          setTabContentFromDisk(tabId, fresh);
        }
      } catch {
        // Best-effort. If the re-read fails (file vanished between
        // apply and reload), the existing tab keeps its old buffer.
      }
    },
    [currentProject, setTabContentFromDisk]
  );

  // Debounced preview — re-runs whenever the find / replace / toggle
  // state changes, mirroring the existing `ProjectSearch` debounce.
  useEffect(() => {
    if (!currentProject) return;
    const rootId = currentProject.rootId;
    const handle = window.setTimeout(() => {
      void preview(rootId);
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, replacement, regex, caseSensitive, currentProject, preview]);

  useEffect(() => {
    findInputRef.current?.focus();
    return () => {
      clear();
    };
  }, [clear]);

  const handleApplyToFile = useCallback(
    async (relativePath: string) => {
      if (!currentProject) return;
      // implementation note — if the file is currently open in a
      // tab, switch the active tab to that file BEFORE applying so
      // the user can see the change on the surface they already had.
      // After the IPC apply succeeds, re-read the file from disk and
      // refresh the tab buffer via `setTabContentFromDisk` so the
      // on-screen content matches the new disk content (no dirty
      // marker, since disk and buffer agree). Cmd+Z does NOT restore
      // the change — the confirmation modal copy is explicit about
      // this.
      const matchingTab = openTabForRelativePath(relativePath);
      if (matchingTab) {
        setActiveTab(matchingTab.id);
      }
      if (matchingTab?.isDirty) {
        pushDirtyOpenTabNotice(relativePath);
        return;
      }
      const result = await applyToFileAction(relativePath);
      // Reviewer-flagged HIGH (implementation note Monaco path was dead code).
      // Refresh the in-memory tab from disk on success so the open
      // tab's buffer reflects the replacement.
      if (result.ok && matchingTab) {
        await refreshOpenTabFromDisk(matchingTab.id, relativePath);
      }
      void trackEvent('editor.replace_in_files_applied', {
        scope: 'single-file',
        // implementation reviewer pass — bucket the real replaced
        // count (0 included). The previous `|| 1` fallback mapped
        // every failed apply to bucket `'1'`, inflating the
        // "successful replace" telemetry with no-op events.
        countBucket: bucketDependencyCount(result.replaced),
        regex,
      });
    },
    [
      applyToFileAction,
      currentProject,
      openTabForRelativePath,
      pushDirtyOpenTabNotice,
      refreshOpenTabFromDisk,
      setActiveTab,
      regex,
    ]
  );

  const handleApplyToAll = useCallback(async () => {
    setConfirmOpen(false);
    const eligibleResults = results.filter(
      (r) => !r.regexTimedOut && r.matches.length > 0
    );
    const dirtyOpenResult = eligibleResults.find(
      (result) => openTabForRelativePath(result.relativePath)?.isDirty
    );
    if (dirtyOpenResult) {
      pushDirtyOpenTabNotice(dirtyOpenResult.relativePath);
      return;
    }
    const openTabsToRefresh = eligibleResults.flatMap((result) => {
      const tab = openTabForRelativePath(result.relativePath);
      return tab ? [{ relativePath: result.relativePath, tabId: tab.id }] : [];
    });
    const result = await applyToAllAction();
    if (result.ok > 0) {
      for (const entry of openTabsToRefresh) {
        await refreshOpenTabFromDisk(entry.tabId, entry.relativePath);
      }
    }
    void trackEvent('editor.replace_in_files_applied', {
      scope: 'all-files',
      countBucket: bucketDependencyCount(result.replaced),
      regex,
    });
  }, [
    applyToAllAction,
    openTabForRelativePath,
    pushDirtyOpenTabNotice,
    refreshOpenTabFromDisk,
    results,
    regex,
  ]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    handleCloseOnEscape(event, onClose);
  };

  const hasQuery = query.length > 0;
  const installableFileCount = useMemo(
    () =>
      results.filter((r) => !r.regexTimedOut && r.matches.length > 0).length,
    [results]
  );
  const showEmptyState = status === 'ready' && results.length === 0 && hasQuery;
  const showNoProject = !currentProject;

  return (
    <OverlayBackdrop align="top" onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-label={t('projectReplace.overlay.title')}
        className="w-full max-w-3xl"
        data-testid="project-replace-overlay"
      >
        <div className="surface-header flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Search size={16} className="shrink-0 text-muted" />
            <input
              ref={findInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('projectReplace.find.placeholder')}
              aria-label={t('projectReplace.find.placeholder')}
              className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted"
              data-testid="project-replace-find-input"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="icon-button"
                aria-label={t('projectReplace.find.clear')}
              >
                <X size={12} />
              </button>
            )}
            <Kbd>esc</Kbd>
          </div>
          <div className="flex items-center gap-3">
            <RotateCcw size={16} className="shrink-0 text-muted" />
            <input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('projectReplace.replace.placeholder')}
              aria-label={t('projectReplace.replace.placeholder')}
              className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted"
              data-testid="project-replace-replacement-input"
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-caption text-muted">
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={regex}
                  onChange={(event) => setRegex(event.target.checked)}
                  data-testid="project-replace-regex-toggle"
                />
                {t('projectReplace.regexToggle.label')}
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(event) =>
                    setCaseSensitive(event.target.checked)
                  }
                  data-testid="project-replace-case-toggle"
                />
                {t('projectReplace.caseToggle.label')}
              </label>
            </div>
            <div
              className="flex flex-wrap items-center gap-1 text-eyebrow text-fg-subtle"
              data-testid="project-replace-excludes-chips"
            >
              <span>{t('projectReplace.excludes.label')}</span>
              {EXCLUDE_CHIPS.map((name) => (
                <span
                  key={name}
                  className="rounded-sm border border-border/40 bg-surface/30 px-1 font-mono"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {applyProgress ? (
          <div
            className="border-t border-border/60 bg-surface/30 px-4 py-1 text-caption text-muted"
            data-testid="project-replace-progress"
          >
            {t('projectReplace.progress', {
              done: applyProgress.done,
              total: applyProgress.total,
            })}
          </div>
        ) : null}

        <div
          className="max-h-[28rem] overflow-y-auto"
          data-testid="project-replace-list"
        >
          {showNoProject ? (
            <p className="px-4 py-10 text-center text-body text-muted">
              {t('projectReplace.empty.noProject')}
            </p>
          ) : status === 'error' ? (
            <p className="px-4 py-10 text-center text-body text-danger">
              {error ?? ''}
            </p>
          ) : showEmptyState ? (
            <p className="px-4 py-10 text-center text-body text-muted">
              {t('projectReplace.empty.noMatch', { query })}
            </p>
          ) : !hasQuery ? (
            <p className="px-4 py-10 text-center text-body text-muted">
              {t('projectReplace.empty.body')}
            </p>
          ) : (
            results.map((result) => (
              <FileRow
                key={result.relativePath}
                result={result}
                applying={applying.has(result.relativePath)}
                onApply={(rel) => void handleApplyToFile(rel)}
              />
            ))
          )}
        </div>

        {hasQuery && installableFileCount >= 1 ? (
          <footer className="flex items-center justify-between gap-3 border-t border-border/70 bg-surface/30 px-4 py-2 text-body-sm text-muted">
            <span>
              {t('projectReplace.matchCount', {
                count: totalMatches,
                fileCount: installableFileCount,
              })}
            </span>
            <button
              type="button"
              disabled={installableFileCount === 0 || applyProgress !== null}
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-primary/30 px-3 py-1 text-caption font-medium text-foreground hover:bg-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="project-replace-apply-all"
            >
              {t('projectReplace.applyToAll.button')}
            </button>
          </footer>
        ) : null}
      </OverlayCard>

      {confirmOpen ? (
        <ConfirmDialog
          testId="project-replace-confirm"
          title={t('projectReplace.confirm.title', {
            fileCount: installableFileCount,
          })}
          body={t('projectReplace.confirm.body', {
            count: totalMatches,
            fileCount: installableFileCount,
          })}
          confirmLabel={t('projectReplace.applyToAll.button')}
          cancelLabel={t('projectReplace.confirm.cancel')}
          onConfirm={() => void handleApplyToAll()}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </OverlayBackdrop>
  );
}
