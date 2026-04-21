import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import type { DeveloperUtilityId } from '../../data/developerUtilities';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUpdateStore } from '../../stores/updateStore';
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
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { addTab, openFileFromDisk, saveActiveTabAs, duplicateActiveTab } = useEditorStore();
  const { snippets } = useSnippetsStore();
  const executionHistory = useExecutionHistoryStore((state) => state.entries);
  const { setLayoutPreset } = useSettingsStore();
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
      executionHistory,
      onFocusLanguageTab: focusLanguageTab,
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
    executionHistory,
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
    const element = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
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
      <OverlayCard className="w-full max-w-2xl">
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
