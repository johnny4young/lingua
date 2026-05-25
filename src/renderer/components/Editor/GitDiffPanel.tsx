/**
 * RL-102 Slice 1 — Git diff bottom-panel sibling tab.
 *
 * Renders the Monaco diff editor with the HEAD version vs. the
 * working-tree version of the active tab's file. Auto-fetches on
 * mount + on every gitStore status flip + on every active-tab change.
 *
 * States:
 *   - `loading`     → "Loading diff..." placeholder.
 *   - `empty`       → "No changes to show." (clean file or untracked
 *                     with empty disk content).
 *   - `binary/cap`  → Truncated hint pinned above the diff editor.
 *   - `error`       → Soft "Couldn't load diff" — same shape as
 *                     console-side fallback for diff-fetch IPC error.
 *
 * Telemetry: `git.diff_panel_opened` (fold D) fires once per panel
 * mount, gated by `panelIsActive` so a hidden mount (the panel exists
 * in the AppLayout sibling list but the user is on Console) does
 * not emit.
 *
 * Note: the Monaco diff editor lazy-loads the same Monaco instance
 * the main code editor uses. Mounting the panel is cheap because
 * Monaco's web worker is already booted; only the diff editor
 * decorations layer is incremental.
 */

import { DiffEditor } from '@monaco-editor/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trackGitDiffPanelOpened } from '../../hooks/gitTelemetry';
import { useEditorStore } from '../../stores/editorStore';
import { useGitStore } from '../../stores/gitStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';

interface DiffState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  originalContent: string;
  modifiedContent: string;
  truncated: boolean;
}

const EMPTY_DIFF: DiffState = {
  status: 'idle',
  originalContent: '',
  modifiedContent: '',
  truncated: false,
};

export function GitDiffPanel() {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const activeTab = useEditorStore((state) =>
    state.tabs.find((tab) => tab.id === activeTabId) ?? null
  );
  const posture = useGitStore((state) => state.posture);
  const fileEntry = useGitStore((state) =>
    activeTab?.filePath ? state.byFile.get(activeTab.filePath) : undefined
  );
  // RL-102 Slice 2 fold B — auto-refresh on HEAD change. Subscribing
  // to `posture.commit` separately (instead of relying on the broader
  // posture object identity) means a HEAD change resolves to the
  // new commit hash via `applyHeadChange`, which flips this primitive,
  // which re-runs the diff-fetch effect below. Without this, the
  // user sees a stale diff after a sibling-terminal checkout until
  // they manually toggle the panel.
  const postureCommit = useGitStore((state) => state.posture?.commit);
  const theme = useSettingsStore((state) => state.editorTheme);
  const panelIsActive = useUIStore(
    (state) => state.activeBottomPanel === 'git-diff'
  );

  const [diff, setDiff] = useState<DiffState>(EMPTY_DIFF);

  // Fire the panel-opened telemetry once per mount lifecycle when the
  // panel is actually visible. Using `panelIsActive` as the gate
  // prevents a hidden mount (RL-093 keeps siblings in the DOM for
  // animation purposes) from inflating the metric.
  const telemetryFiredRef = useRef(false);
  useEffect(() => {
    if (panelIsActive && !telemetryFiredRef.current) {
      telemetryFiredRef.current = true;
      trackGitDiffPanelOpened();
    }
  }, [panelIsActive]);

  // Fetch diff content when the active tab + fileEntry change. The
  // fileEntry dep means a status flip (modified → clean → modified)
  // re-fetches automatically.
  useEffect(() => {
    const bridge = window.lingua?.git;
    if (!bridge) {
      setDiff(EMPTY_DIFF);
      return;
    }
    if (!posture?.available || !posture.repoRoot) {
      setDiff(EMPTY_DIFF);
      return;
    }
    if (!activeTab?.filePath) {
      setDiff(EMPTY_DIFF);
      return;
    }
    const repoRoot = posture.repoRoot;
    const filePath = activeTab.filePath;
    let cancelled = false;
    setDiff((prev) => ({ ...prev, status: 'loading' }));
    bridge
      .diff(repoRoot, filePath)
      .then((result) => {
        if (cancelled) return;
        setDiff({
          status: 'loaded',
          originalContent: result.originalContent,
          modifiedContent: result.modifiedContent,
          truncated: result.truncated,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDiff({
          status: 'error',
          originalContent: '',
          modifiedContent: '',
          truncated: false,
        });
      });
    return () => {
      cancelled = true;
    };
    // RL-102 Slice 2 fold B — `postureCommit` invalidates the
    // memo on HEAD-change so the diff re-fetches against the new
    // HEAD revision. Including it as a dep avoids the cost of a
    // tree-wide subscription on the whole posture object.
  }, [
    activeTab?.filePath,
    posture?.available,
    posture?.repoRoot,
    fileEntry,
    postureCommit,
  ]);

  const monacoLanguage = useMemo(() => {
    const lang = activeTab?.language;
    if (!lang) return undefined;
    // Map Lingua language ids to Monaco language ids. The Monaco
    // builtins cover the common case; unknown languages fall back
    // to `plaintext` which still produces a usable side-by-side view.
    const MAP: Record<string, string> = {
      javascript: 'javascript',
      typescript: 'typescript',
      python: 'python',
      ruby: 'ruby',
      go: 'go',
      rust: 'rust',
      lua: 'lua',
    };
    return MAP[lang] ?? 'plaintext';
  }, [activeTab?.language]);

  if (!posture?.available) {
    // The panel mount itself is conditional in AppLayout, but
    // defense-in-depth: if a sibling render leaks an inactive
    // posture state, fall back to the empty hint.
    return (
      <EmptyHint
        title={t('editor.git.diffPanel.title')}
        body={t('editor.git.diffPanel.unavailable')}
      />
    );
  }

  if (!activeTab?.filePath) {
    return (
      <EmptyHint
        title={t('editor.git.diffPanel.title')}
        body={t('editor.git.diffPanel.noActiveFile')}
      />
    );
  }

  if (diff.status === 'loading') {
    return (
      <EmptyHint
        title={t('editor.git.diffPanel.title')}
        body={t('editor.git.diffPanel.loading')}
      />
    );
  }

  if (diff.status === 'error') {
    return (
      <EmptyHint
        title={t('editor.git.diffPanel.title')}
        body={t('editor.git.diffPanel.error')}
      />
    );
  }

  // Clean / clean-untracked → empty hint instead of an empty diff
  // editor (an empty Monaco diff editor draws two grey panes which
  // reads as "broken" to most users).
  const cleanAndEmpty =
    diff.originalContent.length === 0 &&
    diff.modifiedContent.length === 0;
  if (cleanAndEmpty) {
    return (
      <EmptyHint
        title={t('editor.git.diffPanel.title')}
        body={t('editor.git.diffPanel.empty')}
      />
    );
  }

  return (
    <div
      data-testid="git-diff-panel"
      className="flex h-full flex-col overflow-hidden"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-medium">
          {t('editor.git.diffPanel.title')}
        </span>
        {diff.truncated ? (
          <span
            data-testid="git-diff-panel-truncated"
            className="text-amber-600 dark:text-amber-300"
          >
            {t('editor.git.diffPanel.truncatedHint')}
          </span>
        ) : null}
      </header>
      <div className="flex-1 min-h-0">
        <DiffEditor
          height="100%"
          original={diff.originalContent}
          modified={diff.modifiedContent}
          language={monacoLanguage}
          theme={theme === 'lingua-dark' ? 'vs-dark' : 'vs'}
          options={{
            readOnly: true,
            renderSideBySide: true,
            // Slice 1 is read-only; future Slice 2+ might enable
            // inline edits with stage/unstage actions.
            originalEditable: false,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            fontLigatures: true,
            renderOverviewRuler: false,
            // The bottom panel is short; word wrap helps users see
            // wide changes without horizontal scrolling.
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}

interface EmptyHintProps {
  title: string;
  body: string;
}

function EmptyHint({ title, body }: EmptyHintProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center text-sm">
      <div className="font-medium">{title}</div>
      <div className="text-muted">{body}</div>
    </div>
  );
}
