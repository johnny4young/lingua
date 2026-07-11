import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../stores/editorStore';
import { EditorTabContextMenu } from './EditorTabContextMenu';
import { EditorTabItem, TabsOverflowDropdown } from './EditorTabItems';
import {
  computeVisibleTabs,
  decodeEditorTab,
  encodeEditorTab,
  type EditorTabSummary,
} from './editorTabModel';

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
  const encodedTabs = useEditorStore(
    useShallow((state) => state.tabs.map(encodeEditorTab))
  );
  const tabs = encodedTabs.map(decodeEditorTab);
  const activeTabId = useEditorStore(state => state.activeTabId);
  const setActiveTab = useEditorStore(state => state.setActiveTab);
  const closeTab = useEditorStore(state => state.closeTab);
  const renameTab = useEditorStore(state => state.renameTab);
  const duplicateActiveTab = useEditorStore(state => state.duplicateActiveTab);
  const closeOtherTabs = useEditorStore(state => state.closeOtherTabs);
  const closeTabsToRight = useEditorStore(state => state.closeTabsToRight);
  const closeAllTabs = useEditorStore(state => state.closeAllTabs);
  const { t } = useTranslation();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  // P3 — the encoded useShallow projection above prevents this parent from
  // rendering for content-only writes. Stable callbacks + memoized rows remain
  // useful for the metadata changes that legitimately update one tab.
  const visibleTabsRef = useRef<EditorTabSummary[]>([]);
  const activeTabIdRef = useRef<string | null>(activeTabId);

  // UX Sweep T6 — roving-tabindex arrow navigation across the visible tab
  // strip. Selection follows focus (automatic activation), matching the
  // click/Enter behavior and the `tabIndex={isActive ? 0 : -1}` roving below.
  // Focus the target after the roving tabindex updates on the next frame.
  const moveFocusToTab = useCallback(
    (targetTab: EditorTabSummary | undefined) => {
      if (!targetTab) return;
      setActiveTab(targetTab.id);
      requestAnimationFrame(() => {
        // Escape only `"`/`\` for the quoted attribute-value selector; a quoted
        // attribute selector needs no CSS.escape for dots etc. (and CSS.escape
        // is absent in some jsdom versions), so this stays test-safe.
        const safeId = targetTab.id.replace(/["\\]/g, '\\$&');
        document
          .querySelector<HTMLElement>(
            `[data-tab-id="${safeId}"] [data-testid="editor-tab-activation"]`
          )
          ?.focus();
      });
    },
    [setActiveTab]
  );

  const handleActivationKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, tabId: string) => {
      const visibleTabs = visibleTabsRef.current;
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
      if (
        event.key === 'ArrowRight' ||
        event.key === 'ArrowLeft' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        event.preventDefault();
        const currentIndex = visibleTabs.findIndex((tab) => tab.id === tabId);
        if (currentIndex === -1) return;
        const lastIndex = visibleTabs.length - 1;
        const targetIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? lastIndex
              : event.key === 'ArrowRight'
                ? (currentIndex + 1) % visibleTabs.length
                : (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
        moveFocusToTab(visibleTabs[targetIndex]);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setActiveTab(tabId);
        return;
      }
      if (event.key === 'F2' && tabId === activeTabIdRef.current) {
        event.preventDefault();
        setRenamingTabId(tabId);
      }
    },
    [setActiveTab, moveFocusToTab, setRenamingTabId]
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, tabId: string) => {
      event.preventDefault();
      setActiveTab(tabId);
      setContextMenu({
        tabId,
        anchor: { top: event.clientY, left: event.clientX },
      });
    },
    [setActiveTab]
  );

  const handleCloseTab = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, tabId: string) => {
      event.stopPropagation();
      void closeTab(tabId);
    },
    [closeTab]
  );

  const handleStartRename = useCallback((tabId: string) => {
    setRenamingTabId(tabId);
  }, [setRenamingTabId]);

  const handleCommitRename = useCallback(
    (tabId: string, next: string) => {
      renameTab(tabId, next);
      setRenamingTabId(null);
    },
    [renameTab, setRenamingTabId]
  );

  const handleCancelRename = useCallback(() => {
    setRenamingTabId(null);
  }, [setRenamingTabId]);

  const closeContextMenu = () => setContextMenu(null);

  // RL-093 review — the handoff caps the strip at five tabs, but
  // showing only the first five hides the active tab whenever the
  // user activates anything past index 4 from the overflow dropdown
  // (or by keyboard). Without `data-active="true"` on any visible
  // tab, the strip then has no highlight and the user has to reopen
  // the dropdown to confirm which file is foreground.
  //
  // MOV.02 (FASE 3) — workspace + notebook tabs are full-screen
  // surfaces the user juggles deliberately, so they must never be
  // buried in the overflow either. We compute a priority set
  // (every kind-bearing tab + the active tab), guarantee those are
  // visible, and fill the remaining slots with code tabs in their
  // original order. Original strip order is always preserved so the
  // tabs don't reshuffle as priority changes.
  // UX Sweep T6 — `const` (computed in a module helper) rather than a
  // reassigned `let`, so the arrow-key handler can close over it without
  // tripping the "reassign after render" hazard.
  const visibleTabs = computeVisibleTabs(tabs, activeTabId);
  const hiddenTabCount = tabs.length - visibleTabs.length;
  // Keep the refs current (after commit) so the memoized arrow-key
  // handler reads the latest visible ordering + active id at event time
  // without being recreated on every render. A keyboard event always
  // fires after the effect has committed, so the refs are never stale
  // for the interaction that reads them.
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
    visibleTabsRef.current = visibleTabs;
  });

  if (tabs.length === 0) return null;

  return (
    <>
      <div
        role="group"
        aria-label={t('editorTabs.ariaLabel')}
        className="relative flex h-[34px] items-stretch overflow-hidden bg-surface-strong/72"
      >
        {visibleTabs.map((tab, index) => (
          <EditorTabItem
            key={tab.id}
            tab={tab}
            index={index}
            isActive={tab.id === activeTabId}
            isRenaming={renamingTabId === tab.id}
            t={t}
            onContextMenu={handleContextMenu}
            onActivate={setActiveTab}
            onActivationKeyDown={handleActivationKey}
            onStartRename={handleStartRename}
            onCommitRename={handleCommitRename}
            onCancelRename={handleCancelRename}
            onClose={handleCloseTab}
          />
        ))}
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
              onSelect={id => setActiveTab(id)}
              onClose={id => void closeTab(id)}
            />
          </>
        ) : null}
      </div>
      {contextMenu &&
        (() => {
          const tabIndex = tabs.findIndex(tab => tab.id === contextMenu.tabId);
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
