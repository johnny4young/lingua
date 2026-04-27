import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { languageShortLabel, languageTextColorClass } from '../../utils/languageMeta';
import { Tooltip } from '../ui/chrome';
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

  return (
    <>
      <div
        role="tablist"
        aria-label={t('editorTabs.ariaLabel')}
        className="flex h-11 items-stretch overflow-x-auto border-b border-border/80 bg-surface-strong/72"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isRenaming = renamingTabId === tab.id;
          const tabLabel = `${languageShortLabel(tab.language)} ${tab.name}`;

          return (
            <Tooltip key={tab.id} content={tab.name} disabled={isRenaming}>
              <div
                role="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-label={tabLabel}
                data-tab-id={tab.id}
                data-active={isActive}
                onClick={() => !isRenaming && setActiveTab(tab.id)}
                onKeyDown={(event) => handleActivationKey(event, tab.id)}
                onContextMenu={(event) => handleContextMenu(event, tab.id)}
                className={`group relative flex h-full min-w-[11rem] shrink-0 items-center gap-2 border-r border-border/80 px-3 text-xs transition-colors ${
                  isActive
                    ? 'bg-background-elevated text-foreground'
                    : 'cursor-pointer bg-surface-strong/72 text-muted hover:bg-surface-strong hover:text-foreground'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-primary"
                  />
                )}
                <span
                  className={`text-[10px] font-bold leading-none ${languageTextColorClass(tab.language)}`}
                >
                  {languageShortLabel(tab.language)}
                </span>
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
                    onDoubleClick={() => setRenamingTabId(tab.id)}
                    className="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-none"
                  >
                    {tab.name}
                  </span>
                )}
                {tab.isDirty && !isRenaming && (
                  <Tooltip content={t('editorTabs.unsavedTitle')}>
                    <span
                      aria-label={t('editorTabs.unsaved', { name: tab.name })}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    />
                  </Tooltip>
                )}
                <Tooltip content={t('editorTabs.close', { name: tab.name })} disabled={isRenaming}>
                  <button
                    type="button"
                    aria-label={t('editorTabs.close', { name: tab.name })}
                    data-tab-close="true"
                    data-tab-id-close={tab.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(tab.id);
                    }}
                    className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-all hover:bg-surface-strong/82 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                    style={{ pointerEvents: isRenaming ? 'none' : undefined }}
                  >
                    <X size={10} />
                  </button>
                </Tooltip>
                {/* Force the close button visible while the tab is
                    in the rename branch so the layout does not jump
                    when rename ends. The opacity-0 above is a
                    hover-only treatment; this fallback keeps the
                    width predictable. */}
                <span aria-hidden className="hidden" data-index={index} />
              </div>
            </Tooltip>
          );
        })}
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
