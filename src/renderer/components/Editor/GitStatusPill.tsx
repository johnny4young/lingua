/**
 * RL-102 Slice 1 — per-tab Git status pill.
 *
 * Visual language:
 *
 *   - `clean`     → tiny emerald dot (3 px), no text. Most tabs are
 *                   clean; a full word here would be visual noise.
 *   - `modified`  → amber chip with `M` and optional `±N/-N` numstat
 *                   counts when known. Soft amber fill.
 *   - `untracked` → rose chip with `U`. Same shape as modified so
 *                   the tab strip stays visually stable as files
 *                   transition from untracked → tracked → modified.
 *   - `unknown`   → slate chip with `?`. Used when git isn't on
 *                   PATH or a per-file query failed. Mostly invisible
 *                   chrome — the tooltip carries the diagnostic.
 *
 * Click: dispatches `lingua-git-open-diff` so `<AppLayout>` flips
 *   the bottom panel to the Diff tab. The pill is small enough that
 *   a fat-finger click on a clean dot is unlikely; we still wire
 *   the action for `clean` so users can preview the file in the
 *   diff editor regardless of state.
 *
 * Right-click (fold C): renders a context menu portal anchored to
 *   the click position. Three actions today:
 *     - "Show diff"        — same as left-click.
 *     - "Copy file path"   — `navigator.clipboard.writeText(filePath)`.
 *     - "Reveal in SC"     — asks main to open the repo root in the
 *                            OS file manager.
 *
 * Self-gates:
 *   - `gitStatusSuppressedByMagicComment(language, code)` → null.
 *   - `posture.available === false` → null.
 *   - `byFile.get(filePath) === undefined` → null (still loading;
 *     the pill appears once the first status query resolves so the
 *     tab strip doesn't flicker with a placeholder).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { trackGitRevealInSourceControlClicked } from '../../hooks/gitTelemetry';
import { useGitStore } from '../../stores/gitStore';
import { useUIStore } from '../../stores/uiStore';
import { gitStatusSuppressedByMagicComment } from '../../utils/magicComments';
import type { GitFileStatusEntry } from '../../stores/gitStore';

type GitFileStatusKind = 'clean' | 'modified' | 'untracked' | 'unknown';

export interface GitStatusPillProps {
  filePath: string;
  /** Language of the active tab; gates the magic-comment opt-out. */
  language?: string;
  /** Live tab content; checked for `// @git-ignore-status`. */
  content?: string;
  /** Precomputed strip projection; avoids forwarding the whole editor buffer. */
  suppressedByMagic?: boolean;
}

interface PillVisualSpec {
  className: string;
  letter: string | null;
  showDot: boolean;
}

const PILL_VISUAL: Record<GitFileStatusKind, PillVisualSpec> = {
  clean: {
    className:
      'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-500/20',
    letter: null,
    showDot: true,
  },
  modified: {
    className:
      'text-amber-700 dark:text-amber-300 bg-amber-500/15 ring-1 ring-amber-500/25',
    letter: 'M',
    showDot: false,
  },
  untracked: {
    className:
      'text-rose-700 dark:text-rose-300 bg-rose-500/15 ring-1 ring-rose-500/25',
    letter: 'U',
    showDot: false,
  },
  unknown: {
    className: 'text-muted bg-transparent ring-1 ring-border/40',
    letter: '?',
    showDot: false,
  },
};

interface ContextMenuState {
  x: number;
  y: number;
}

export function GitStatusPill({
  filePath,
  language,
  content,
  suppressedByMagic,
}: GitStatusPillProps) {
  const { t } = useTranslation();
  const posture = useGitStore((state) => state.posture);
  const entry: GitFileStatusEntry | undefined = useGitStore(
    (state) => state.byFile.get(filePath)
  );

  // Per-file magic-comment opt-out (fold F). Memoised by content so
  // a clean file with the directive in a comment doesn't re-evaluate
  // on every render.
  const suppressedFromContent = useMemo(
    () => gitStatusSuppressedByMagicComment(language ?? '', content ?? ''),
    [language, content]
  );
  const isSuppressedByMagic = suppressedByMagic ?? suppressedFromContent;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
    null
  );
  // Reviewer pass — declare the ref BEFORE the effect that closes
  // over it. React tolerates the previous (post-effect) declaration
  // because refs are stable across renders, but ESLint
  // `react-hooks/exhaustive-deps` flags the late-bound access and
  // the source order should match the dependency order.
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setContextMenu(null), []);

  // Close menu on outside-click / Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const onDocClick = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current) return;
      if (
        event.target instanceof Node &&
        menuRef.current.contains(event.target)
      ) {
        return;
      }
      closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu, closeMenu]);

  const openDiff = useCallback(() => {
    // Reviewer pass — `openBottomPanel` already sets the active tab
    // AND flips `consoleVisible` true, so a preceding
    // `setActiveBottomPanel` call would be a redundant store write
    // (two re-renders + a brief intermediate state where the tab is
    // switched but the panel still collapsed under React 17-style
    // batching). One call is sufficient.
    useUIStore.getState().openBottomPanel('git-diff');
  }, []);

  const handleClick = useCallback(() => {
    if (contextMenu) {
      closeMenu();
      return;
    }
    openDiff();
  }, [contextMenu, closeMenu, openDiff]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCopyPath = useCallback(async () => {
    closeMenu();
    try {
      await navigator.clipboard.writeText(filePath);
    } catch {
      // Best effort; nothing to surface for a clipboard reject in
      // Slice 1. RL-101 Slice 1.5+ pattern would push a status notice
      // here — deferred to Slice 2.
    }
  }, [filePath, closeMenu]);

  // RL-102 Slice 2 — Reveal in Source Control. Calls the new
  // `git:reveal` IPC, telemetry-tags the click as `'repo-root'`
  // (closed-enum extension point for Slice 3+ targets), and
  // surfaces a localized notice when the OS refuses the open.
  const handleRevealInSc = useCallback(async () => {
    closeMenu();
    const bridge = window.lingua?.git;
    const repoRoot = posture?.repoRoot;
    if (!bridge?.reveal || !repoRoot) return;
    trackGitRevealInSourceControlClicked('repo-root');
    let ok: boolean;
    try {
      ok = await bridge.reveal(repoRoot);
    } catch {
      ok = false;
    }
    if (!ok) {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'git.reveal.error.notFound',
      });
    }
  }, [closeMenu, posture?.repoRoot]);

  // Bail-outs (post-hooks so React rules-of-hooks stay clean).
  if (!posture?.available) return null;
  if (isSuppressedByMagic) return null;
  if (!entry) return null;

  // `PILL_VISUAL[entry.status]` is provably defined because
  // `entry.status` is the closed `GitFileStatusKind` enum that
  // PILL_VISUAL keys against; the explicit fallback satisfies the
  // `noUncheckedIndexedAccess` tsconfig flag.
  const spec = PILL_VISUAL[entry.status] ?? PILL_VISUAL.unknown;
  // Compact counts for modified files, e.g. "+5 −3". Skipped when the
  // numstat is zero on both sides (e.g. binary diff or unfetched).
  const showCounts =
    entry.status === 'modified' &&
    typeof entry.insertions === 'number' &&
    typeof entry.deletions === 'number' &&
    (entry.insertions > 0 || entry.deletions > 0);

  // Tooltip composition. The branch name is always part of the
  // tooltip so the user can confirm which branch the chip reflects;
  // a future Slice 2 may also pin the branch inline next to the
  // pill (RL-112 persistent status bar reuses this signal).
  const branchLabel = posture.branch ?? t('editor.git.tooltip.detachedHead');
  const tooltipKey = `editor.git.tooltip.${entry.status}` as const;
  const tooltip = showCounts
    ? `${t(tooltipKey)} · ${branchLabel} · +${entry.insertions} −${entry.deletions}`
    : `${t(tooltipKey)} · ${branchLabel}`;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={tooltip}
        aria-label={tooltip}
        data-testid="git-status-pill"
        data-git-status={entry.status}
        data-git-branch={posture.branch ?? null}
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-eyebrow font-medium leading-[14px] transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${spec.className}`}
      >
        {spec.showDot ? (
          <span
            aria-hidden="true"
            className="inline-block size-[6px] rounded-full bg-current"
          />
        ) : (
          <span aria-hidden="true">{spec.letter}</span>
        )}
        {showCounts ? (
          <span className="opacity-80 tabular-nums">
            +{entry.insertions} −{entry.deletions}
          </span>
        ) : null}
      </button>

      {contextMenu
        ? createPortal(
            // Reviewer pass — portal to `document.body` so a `transform`
            // / `filter` / `overflow-hidden` ancestor (the tab strip
            // applies `overflow-hidden` for the truncation ellipsis)
            // can't clip the fixed-positioned menu.
            <div
              ref={menuRef}
              role="menu"
              aria-label={t('editor.git.contextMenu.ariaLabel')}
              data-testid="git-status-pill-menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              className="fixed z-[1000] min-w-[180px] rounded-md border border-border bg-surface shadow-lg py-1 text-body"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  openDiff();
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-surface-hover"
              >
                {t('editor.git.contextMenu.showDiff')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleCopyPath}
                className="block w-full px-3 py-1.5 text-left hover:bg-surface-hover"
              >
                {t('editor.git.contextMenu.copyPath')}
              </button>
              {/* RL-102 Slice 2 — Reveal action enabled. Falls back
                  to disabled chrome only when the bridge OR repoRoot
                  is missing (defense in depth — `posture.available`
                  should already guard the parent surface, but a
                  same-render race could leave repoRoot transiently
                  empty). */}
              <button
                type="button"
                role="menuitem"
                onClick={handleRevealInSc}
                disabled={
                  !posture?.repoRoot || !window.lingua?.git?.reveal
                }
                title={t('git.reveal.action.tooltip')}
                className="block w-full px-3 py-1.5 text-left hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent"
              >
                {t('editor.git.contextMenu.revealInSc')}
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
