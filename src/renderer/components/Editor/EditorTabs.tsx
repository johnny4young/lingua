import { ChevronDown, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { languageBadgeTone, languageShortLabel } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { Kbd, Tooltip } from '../ui/chrome';
import type { FileTab, TabExecutionState } from '../../types';
import { EditorTabContextMenu } from './EditorTabContextMenu';

interface ContextMenuState {
  tabId: string;
  anchor: { top: number; left: number };
}

/**
 * Editor tab strip aligned with the DS canonical
 * (lingua/project/components/signal-tabs-editor.jsx). Active tabs
 * announce themselves with a 2px accent border-top + panel bg;
 * inactive tabs ride on panel-alt. The filename uses JetBrains Mono
 * so the strip reads as part of the editor surface, not as
 * UI chrome.
 *
 * Right-click opens a context menu with the six DS actions
 * (Close / Close others / Close to the right / Close all / Rename /
 * Duplicate). Double-click on the filename or F2 on the active tab
 * starts an inline rename — Enter commits, Escape cancels.
 */
export function EditorTabs() {
  const tabs = useEditorStore((state) => state.tabs);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const closeTab = useEditorStore((state) => state.closeTab);
  const renameTab = useEditorStore((state) => state.renameTab);
  const duplicateActiveTab = useEditorStore((state) => state.duplicateActiveTab);
  const closeOtherTabs = useEditorStore((state) => state.closeOtherTabs);
  const closeTabsToRight = useEditorStore((state) => state.closeTabsToRight);
  const closeAllTabs = useEditorStore((state) => state.closeAllTabs);
  const { t } = useTranslation();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  // Close a menu anchored to a tab that may have disappeared after
  // another close operation.
  useEffect(() => {
    setContextMenu(null);
  }, [tabs.length]);

  if (tabs.length === 0) return null;

  const handleActivationKey = (
    event: KeyboardEvent<HTMLDivElement>,
    tabId: string
  ) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setActiveTab(tabId);
      setContextMenu({
        tabId,
        anchor: { top: rect.bottom + 4, left: rect.left + 8 },
      });
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setActiveTab(tabId);
      return;
    }
    if (event.key === 'F2' && tabId === activeTabId) {
      event.preventDefault();
      setRenamingTabId(tabId);
    }
  };

  const handleContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    tabId: string
  ) => {
    event.preventDefault();
    setActiveTab(tabId);
    setContextMenu({
      tabId,
      anchor: { top: event.clientY, left: event.clientX },
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  // RL-093 review — the handoff caps the strip at five tabs, but
  // showing only the first five hides the active tab whenever the
  // user activates anything past index 4 from the overflow dropdown
  // (or by keyboard). Without `data-active="true"` on any visible
  // tab, the strip then has no highlight and the user has to reopen
  // the dropdown to confirm which file is foreground. Pin the active
  // tab into the last visible slot when it sits past the cap so the
  // 5-tab budget is respected and the active highlight stays anchored.
  const VISIBLE_TAB_CAP = 5;
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const visibleTabs =
    tabs.length <= VISIBLE_TAB_CAP
      ? tabs
      : activeIndex >= VISIBLE_TAB_CAP
        ? [...tabs.slice(0, VISIBLE_TAB_CAP - 1), tabs[activeIndex]!]
        : tabs.slice(0, VISIBLE_TAB_CAP);
  const hiddenTabCount = tabs.length - visibleTabs.length;

  return (
    <>
      <div
        role="tablist"
        aria-label={t('editorTabs.ariaLabel')}
        className="relative flex h-[34px] items-stretch overflow-hidden bg-surface-strong/72"
      >
        {visibleTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isRenaming = renamingTabId === tab.id;
          const tabLabel = `${languageShortLabel(tab.language)} ${tab.name}`;

          return (
            <Tooltip
              key={tab.id}
              content={resolveTabTooltip(tab, t)}
              disabled={isRenaming}
            >
              <div
                role="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-label={tabLabel}
                data-tab-id={tab.id}
                data-active={isActive}
                data-execution-state={tab.executionState ?? 'idle'}
                onClick={() => !isRenaming && setActiveTab(tab.id)}
                onKeyDown={(event) => handleActivationKey(event, tab.id)}
                onContextMenu={(event) => handleContextMenu(event, tab.id)}
                className={cn(
                  'group relative flex h-full min-w-[11rem] shrink-0 items-center gap-2 border-r border-border/60 px-3 text-xs transition-colors',
                  isActive
                    ? // Active: panel bg + 2px top accent + matching bottom border so the
                      // tab visually merges with the editor surface below.
                      '-mb-px bg-background-elevated text-foreground border-t-2 border-t-primary'
                    : 'cursor-pointer border-t-2 border-t-transparent bg-surface-strong/72 text-muted hover:bg-surface-strong hover:text-foreground'
                )}
              >
                {/* Lang chip — uppercase DS badge. The mono face is set
                    inline so the filename span remains the only
                    `.font-mono` element legacy callers query. */}
                <TabLanguageChip language={tab.language} />
                {isRenaming ? (
                  <RenameInput
                    initialName={tab.name}
                    placeholder={t('editorTabs.rename.placeholder')}
                    ariaLabel={t('editorTabs.rename.ariaLabel', { name: tab.name })}
                    onCommit={(next) => {
                      renameTab(tab.id, next);
                      setRenamingTabId(null);
                    }}
                    onCancel={() => setRenamingTabId(null)}
                  />
                ) : (
                  <span
                    data-testid="editor-tab-filename"
                    onDoubleClick={() => setRenamingTabId(tab.id)}
                    className={cn(
                      'min-w-0 flex-1 truncate font-mono text-[11.5px] leading-none',
                      tab.executionState === 'error' && 'text-error/95'
                    )}
                  >
                    {tab.name}
                  </span>
                )}

                {/* Status indicator — single source per tab. Precedence:
                    running > error > success > dirty > none.
                    Hidden when the close button takes over on hover. */}
                {!isRenaming ? (
                  <TabStatusDot
                    tab={tab}
                    unsavedLabel={t('editorTabs.unsaved', { name: tab.name })}
                    closeLabel={t('editorTabs.close', { name: tab.name })}
                    onClose={(event) => {
                      event.stopPropagation();
                      void closeTab(tab.id);
                    }}
                  />
                ) : null}
                <span aria-hidden className="hidden" data-index={index} />
              </div>
            </Tooltip>
          );
        })}
        {/* RL-093 Slice 2 — the handoff keeps five tabs visible and
            collapses the rest into a compact +N file-list menu. */}
        {hiddenTabCount > 0 ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute right-[58px] top-0 h-full w-8 bg-gradient-to-r from-transparent to-surface-strong/95"
            />
            <TabsOverflowDropdown
              tabs={tabs}
              activeTabId={activeTabId}
              hiddenCount={hiddenTabCount}
              onSelect={(id) => setActiveTab(id)}
              onClose={(id) => void closeTab(id)}
            />
          </>
        ) : null}
      </div>
      {contextMenu && (() => {
        const tabIndex = tabs.findIndex((tab) => tab.id === contextMenu.tabId);
        const tab = tabs[tabIndex];
        if (!tab) return null;
        return (
          <EditorTabContextMenu
            anchor={contextMenu.anchor}
            tabName={tab.name}
            isLastTab={tabs.length === 1}
            isRightmost={tabIndex === tabs.length - 1}
            onClose={closeContextMenu}
            onCloseTab={() => void closeTab(tab.id)}
            onCloseOthers={() => void closeOtherTabs(tab.id)}
            onCloseToRight={() => void closeTabsToRight(tab.id)}
            onCloseAll={() => void closeAllTabs()}
            onRename={() => {
              setActiveTab(tab.id);
              setRenamingTabId(tab.id);
            }}
            onDuplicate={() => {
              setActiveTab(tab.id);
              duplicateActiveTab();
            }}
          />
        );
      })()}
    </>
  );
}

/**
 * The inline rename input. Local-state-only so the parent does not
 * see every keystroke. Commits the trimmed value on Enter; cancels on
 * Escape (no commit, no toast). On blur we treat it as a soft commit
 * because users frequently click elsewhere expecting their typed
 * name to stick.
 */
function RenameInput({
  initialName,
  placeholder,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  initialName: string;
  placeholder: string;
  ariaLabel: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    // Highlight the basename so a user who only wants to swap the
    // extension can keep typing without selecting first.
    const dot = initialName.lastIndexOf('.');
    if (dot > 0) node.setSelectionRange(0, dot);
    else node.select();
  }, [initialName]);

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  const commit = () => {
    if (finishedRef.current) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialName) {
      cancel();
      return;
    }
    finishedRef.current = true;
    onCommit(trimmed);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid="editor-tab-rename-input"
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
      className="min-w-0 flex-1 rounded-md border border-primary/45 bg-background-elevated px-1.5 py-0.5 font-mono text-[11.5px] leading-none text-foreground outline-none focus:ring-2 focus:ring-ring/45"
    />
  );
}

/* ---------------------------------------------------------------- */
/* Tab status indicator                                              */
/* ---------------------------------------------------------------- */

/**
 * RL-070 — single source of truth for the tab's right-edge state
 * indicator. The close button replaces whatever dot is showing on
 * hover so the user always has one click to close, regardless of
 * the tab's current lifecycle state.
 *
 * Precedence (matches Signal-Slate):
 *
 *   running → spinning loader
 *   error   → red dot with halo
 *   success → green dot, fades out after 2s via opacity transition
 *   dirty   → primary dot
 *   idle    → no dot (close button still appears on hover)
 */
function TabStatusDot({
  tab,
  unsavedLabel,
  closeLabel,
  onClose,
}: {
  tab: FileTab;
  unsavedLabel: string;
  closeLabel: string;
  onClose: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const state: TabExecutionState = tab.executionState ?? 'idle';

  // Pick the accessible label that matches the visible dot. Dirty + no
  // execution state => surface the historical "unsaved changes" copy
  // so screen-reader callers reading the regression test pass.
  const accessibleLabel =
    state === 'idle' && tab.isDirty ? unsavedLabel : undefined;

  return (
    <span className="relative ml-0.5 inline-flex size-5 shrink-0 items-center justify-center">
      {/* Status marker — hidden on hover so close button can take over. */}
      {state === 'running' ? (
        <Loader2
          size={11}
          className="pointer-events-none absolute animate-spin text-primary transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0"
          aria-hidden="true"
          data-testid="editor-tab-running-spinner"
        />
      ) : (
        <span
          {...(accessibleLabel
            ? { role: 'img', 'aria-label': accessibleLabel }
            : { 'aria-hidden': 'true' as const })}
          className={cn(
            'pointer-events-none absolute inline-block rounded-full transition-opacity duration-150',
            'group-hover:opacity-0 group-focus-visible:opacity-0',
            stateDotClasses(state, tab.isDirty)
          )}
        />
      )}
      {/* Close button — appears on hover/focus. Always rendered (size kept
         predictable) but only visible via opacity. */}
      <button
        type="button"
        aria-label={closeLabel}
        data-tab-close="true"
        data-tab-id-close={tab.id}
        onClick={onClose}
        className="inline-flex size-5 items-center justify-center rounded-md text-muted opacity-0 transition-opacity duration-150 hover:bg-surface-strong/82 hover:text-foreground group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100"
      >
        <X size={10} />
      </button>
    </span>
  );
}

/**
 * Map per-tab state to the dot's color + size + halo.
 *
 * Returns an empty string when there's nothing to show — the
 * absolutely-positioned span still renders for layout, but it has
 * no visual.
 */
function stateDotClasses(state: TabExecutionState, isDirty: boolean): string {
  if (state === 'error') {
    // Red dot with subtle ring so it pops against any tab bg.
    return 'h-2 w-2 bg-error ring-2 ring-error/15';
  }
  if (state === 'success') {
    return 'h-1.5 w-1.5 bg-success';
  }
  if (isDirty) {
    return 'h-1.5 w-1.5 bg-primary';
  }
  return 'h-0 w-0';
}

/**
 * Tooltip text — surfaces parseError details when present so the
 * user knows what failed without opening the console. Falls back to
 * the filename otherwise.
 */
type TFn = (key: string, opts?: Record<string, unknown>) => string;

function resolveTabTooltip(tab: FileTab, t: TFn): string {
  if (tab.executionState === 'error' && tab.parseError) {
    return `${tab.name} · ${tab.parseError}`;
  }
  if (tab.executionState === 'running') {
    return `${tab.name} · ${t('editorTabs.running')}`;
  }
  if (tab.isDirty) {
    return `${tab.name} · ${t('editorTabs.unsavedTitle')}`;
  }
  return tab.name;
}

/**
 * RL-093 Slice 3 — `+N` overflow popover. Provides a single jump
 * point across every open tab without horizontal-scrolling the tab
 * strip. Renders a chevron button at the right of the strip; opening
 * the popover gives a scrollable tab list with lang chip, filename,
 * dirty dot, and an inline close button.
 *
 * Outside-click / Escape close the popover.
 */
function TabsOverflowDropdown({
  tabs,
  activeTabId,
  hiddenCount,
  onSelect,
  onClose,
}: {
  tabs: readonly FileTab[];
  activeTabId: string | null;
  hiddenCount: number;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClickAway);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dirtyCount = tabs.filter((tab) => tab.isDirty).length;

  return (
    <div ref={containerRef} className="relative ml-1 flex items-center">
      <Tooltip
        content={t('editorTabs.overflow.tooltip', {
          count: hiddenCount,
          total: tabs.length,
        })}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('editorTabs.overflow.ariaLabel', { count: hiddenCount })}
          data-testid="editor-tabs-overflow"
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            'inline-flex h-full items-center gap-1.5 border-l border-border/60 px-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-muted transition-colors hover:bg-bg-panel-alt/70 hover:text-fg-base',
            open && 'bg-bg-panel-alt text-fg-base',
          )}
        >
          <span>+{hiddenCount}</span>
          <ChevronDown size={11} aria-hidden />
        </button>
      </Tooltip>
      {open ? (
        <div
          role="menu"
          className="dropdown-rich absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[340px] max-h-[400px] flex-col overflow-hidden"
          style={{ display: 'flex' }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              const isHidden = index >= 5;
              return (
                <div
                  key={tab.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                    isActive ? 'bg-primary-soft' : 'hover:bg-bg-panel-alt/70',
                  )}
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`editor-tabs-overflow-item-${tab.id}`}
                    onClick={() => {
                      onSelect(tab.id);
                      setOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <TabLanguageChip language={tab.language} size="menu" />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate font-mono text-[12px]',
                        isActive ? 'text-accent-fg font-semibold' : 'text-fg-base',
                      )}
                    >
                      {tab.name}
                    </span>
                    {isHidden ? (
                      <span
                        aria-hidden
                        className="rounded-full bg-bg-panel-alt px-1.5 font-mono text-[9px] font-semibold text-fg-subtle"
                      >
                        +{index - 4}
                      </span>
                    ) : null}
                    {tab.isDirty ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-warning-fg"
                        title={t('editorTabs.unsavedTitle')}
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                    aria-label={t('editorTabs.close', { name: tab.name })}
                    className="invisible inline-flex size-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-panel hover:text-fg-base group-hover:visible"
                  >
                    <X size={11} aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2 font-mono text-[10.5px] text-fg-subtle">
            <Kbd>↑↓</Kbd>
            <span>{t('actionPill.navigate')}</span>
            <span className="flex-1" />
            <span>
              {t('editorTabs.overflow.footer', {
                total: tabs.length,
                dirty: dirtyCount,
              })}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabLanguageChip({
  language,
  size = 'tab',
}: {
  language: FileTab['language'];
  size?: 'tab' | 'menu';
}) {
  const tone = languageBadgeTone(language);
  return (
    <span
      data-testid="editor-tab-lang-chip"
      className="shrink-0 rounded-[3px] font-bold leading-none"
      style={{
        minWidth: size === 'menu' ? 24 : 21,
        height: size === 'menu' ? 22 : 17,
        padding: size === 'menu' ? '0 5px' : '0 4px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: size === 'menu' ? 9.5 : 9,
        letterSpacing: '0.04em',
        background: tone.background,
        color: tone.foreground,
      }}
    >
      {tone.code}
    </span>
  );
}
