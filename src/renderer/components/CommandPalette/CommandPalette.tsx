import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '../../stores/executionHistoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUIStore } from '../../stores/uiStore';
import { useUpdateStore } from '../../stores/updateStore';
import { useEntitlement } from '../../hooks/useEntitlement';
import {
  getActiveEditorCursorLine,
  getActiveEditorLineText,
} from '../../runtime/editorAccess';
import {
  appendWatchAtLine,
  isAppendWatchSupported,
} from '../../utils/appendWatch';
import type { Language } from '../../types';
import { Kbd, OverlayBackdrop, OverlayCard, Tooltip } from '../ui/chrome';
import { handleCloseOnEscape } from '../ui/keyboard';
import { CommandPaletteResults } from './CommandPaletteResults';
import {
  buildCommandPaletteModel,
  filterCommandPaletteCommands,
} from './commandPaletteModel';

interface CommandPaletteProps {
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
  onOpenSnippets: () => void;
  onOpenProjectSearch?: () => void;
  onOpenGoToSymbol?: () => void;
  onOpenDeveloperUtility?: (id: DeveloperUtilityId) => void;
  onOpenKeyboardShortcuts?: () => void;
  /**
   * RL-028 fourth slice — fires the "Re-run last execution" palette
   * action. Owned by the AppChrome layer so the palette doesn't have
   * to know about runner internals.
   */
  onRerunLast?: () => void;
  /**
   * RL-028 sixth slice trailer — fires when the user activates a
   * per-entry "Replay {language} run …" palette action. The handler
   * dispatches `replayHistoryEntry(entry, ...)` so the run does not
   * append another history entry.
   */
  onReplayEntry?: (entry: ExecutionHistoryEntry) => void;
  /**
   * RL-037 Vim slice — fires the "Toggle Vim mode" palette action.
   * Optional; when omitted the command is hidden.
   */
  onToggleVimMode?: () => void;
}

export function CommandPalette({
  onClose,
  onOpenSettings,
  onOpenWhatsNew,
  onStartGuidedTour,
  onOpenSnippets,
  onOpenProjectSearch,
  onOpenGoToSymbol,
  onOpenDeveloperUtility,
  onOpenKeyboardShortcuts,
  onRerunLast,
  onReplayEntry,
  onToggleVimMode,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { addTab, openFileFromDisk, saveActiveTabAs, duplicateActiveTab, setTabRuntimeMode, updateContent } =
    useEditorStore();
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const tabs = useEditorStore((state) => state.tabs);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeRuntimeMode = languageHasRuntimeModes(activeTab?.language)
    ? (activeTab?.runtimeMode ?? 'worker')
    : null;
  // RL-020 Slice 3 fold E — surface the active tab's language to the
  // palette model so the "Pin watch on current line" action only
  // appears for JS / TS / Python.
  const activeWatchLanguage = activeTab?.language ?? null;
  const { snippets } = useSnippetsStore();
  const canUseExecutionHistory = useEntitlement('EXECUTION_HISTORY');
  const executionHistory = useExecutionHistoryStore((state) => state.entries);
  const { setLayoutPreset } = useSettingsStore();
  const vimMode = useSettingsStore((state) => state.vimMode);
  const { checkForUpdates, restartToApply, status: updateStatus } = useUpdateStore();
  const { t, i18n } = useTranslation();

  // RL-028 third slice — when the user picks a recent-run entry, try to
  // focus a tab that matches the run's language. If there isn't one
  // open today we just close the palette (the action is informational
  // until Slice D of RL-028 wires an actual replay path).
  const focusLanguageTab = (language: Language) => {
    const { tabs, setActiveTab } = useEditorStore.getState();
    const match = tabs.find((tab) => tab.language === language);
    if (match) setActiveTab(match.id);
  };

  const allCommands = useMemo(() => {
    return buildCommandPaletteModel({
      templates: BUILT_IN_TEMPLATES,
      snippets,
      executionHistory: canUseExecutionHistory ? executionHistory : [],
      onFocusLanguageTab: focusLanguageTab,
      onRerunLast: canUseExecutionHistory ? onRerunLast : undefined,
      onReplayEntry: canUseExecutionHistory ? onReplayEntry : undefined,
      onToggleVimMode,
      vimModeEnabled: vimMode,
      // RL-019 Slice 1 fold E — palette wiring. Gate on
      // `activeRuntimeMode !== null` (the JS/TS marker), not just
      // `activeTabId`, so a Python / Go / Rust tab never wires the
      // callback. The model already short-circuits when the field
      // is null; this is the tighter invariant at the call site.
      onSetRuntimeMode:
        activeRuntimeMode !== null && activeTabId
          ? (mode) => setTabRuntimeMode(activeTabId, mode)
          : undefined,
      activeRuntimeMode,
      // RL-020 Slice 3 fold E — read the editor's current line text,
      // delegate to the pure `appendWatchAtLine` helper, write the
      // updated buffer back via `updateContent`. The pure helper
      // returns `null` when the line has no expression (empty,
      // already-watched, comment-only) — in that case we surface a
      // localized notice via the status banner instead of mutating
      // the buffer silently.
      onAddWatchToCurrentLine:
        activeTabId && activeTab && isAppendWatchSupported(activeTab.language)
          ? () => {
              const cursorLine = getActiveEditorCursorLine();
              const lineText = getActiveEditorLineText();
              if (cursorLine === null || lineText === null) {
                useUIStore.getState().pushStatusNotice({
                  tone: 'info',
                  messageKey: 'commandPalette.action.addWatch.unsupported',
                });
                return;
              }
              const next = appendWatchAtLine(
                activeTab.content,
                cursorLine,
                activeTab.language as 'javascript' | 'typescript' | 'python'
              );
              if (next === null) {
                useUIStore.getState().pushStatusNotice({
                  tone: 'info',
                  messageKey: 'commandPalette.action.addWatch.unsupported',
                });
                return;
              }
              updateContent(activeTabId, next);
            }
          : undefined,
      activeWatchLanguage,
      // RL-020 Slice 4 fold G — pass the active tab id so the
      // model can surface the per-tab Recent runs group above the
      // legacy global one. `null` (no active tab) suppresses the
      // group; existing behavior is unchanged.
      activeTabId: activeTabId ?? null,
      updateStatus,
      createTab: addTab,
      createDefaultTab,
      setLayoutPreset,
      onClose,
      onOpenSettings,
      onOpenWhatsNew,
      onStartGuidedTour,
      onOpenSnippets,
      onOpenProjectSearch,
      onOpenGoToSymbol,
      onOpenDeveloperUtility,
      onOpenKeyboardShortcuts,
      checkForUpdates,
      restartToApply,
      openFileFromDisk,
      saveActiveTabAs,
      duplicateActiveTab,
      t,
    });
    // Re-build when the active language changes so labels/descriptions
    // follow i18next. `t` itself has a stable identity in react-i18next,
    // so depend on `i18n.language` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snippets,
    canUseExecutionHistory,
    executionHistory,
    onRerunLast,
    onReplayEntry,
    onToggleVimMode,
    vimMode,
    activeTabId,
    activeRuntimeMode,
    setTabRuntimeMode,
    addTab,
    setLayoutPreset,
    onClose,
    onOpenSettings,
    onOpenSnippets,
    onOpenProjectSearch,
    onOpenGoToSymbol,
    onOpenDeveloperUtility,
    onOpenKeyboardShortcuts,
    checkForUpdates,
    restartToApply,
    updateStatus,
    openFileFromDisk,
    saveActiveTabAs,
    duplicateActiveTab,
    activeWatchLanguage,
    updateContent,
    activeTab,
    i18n.language,
  ]);

  const filtered = useMemo(() => {
    return filterCommandPaletteCommands(allCommands, query);
  }, [allCommands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${selectedIndex}"]`
    );
    element?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((currentIndex) => Math.min(currentIndex + 1, filtered.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((currentIndex) => Math.max(currentIndex - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      filtered[selectedIndex]?.action();
      return;
    }

    handleCloseOnEscape(event, onClose);
  };

  return (
    <OverlayBackdrop align="top" onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.item.commandPalette.label')}
        className="w-full max-w-2xl"
      >
        <div className="surface-header flex items-center gap-3 px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            data-tour-id="command-palette-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.search.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          {query && (
            <Tooltip content={t('commandPalette.search.clear')}>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="button-ghost p-1.5"
                aria-label={t('commandPalette.search.clear')}
              >
                <X size={14} />
              </button>
            </Tooltip>
          )}
          <Kbd>esc</Kbd>
        </div>
        <CommandPaletteResults
          commands={filtered}
          query={query}
          selectedIndex={selectedIndex}
          listRef={listRef}
          onHoverIndex={setSelectedIndex}
        />

        <div className="surface-header flex items-center gap-4 px-4 py-3 text-[11px] text-muted">
          <span>
            <Kbd>↑↓</Kbd> {t('commandPalette.hint.navigate')}
          </span>
          <span>
            <Kbd>↵</Kbd> {t('commandPalette.hint.select')}
          </span>
          <span className="ml-auto">
            {t('commandPalette.results.count', { count: filtered.length })}
          </span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
