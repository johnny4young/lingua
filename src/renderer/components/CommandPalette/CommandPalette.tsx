import { Code, FileCode, Search, X, Zap } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useUpdateStore } from '../../stores/updateStore';
import type { Language } from '../../types';
import {
  extensionForLanguage,
  languageBadgeClass,
  languageShortLabel,
} from '../../utils/languageMeta';
import { Kbd, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { handleCloseOnEscape } from '../ui/keyboard';

type CommandCategory = 'template' | 'snippet' | 'action';

interface Command {
  id: string;
  category: CommandCategory;
  label: string;
  description: string;
  language?: Language;
  keywords: string[];
  action: () => void;
}

const CATEGORY_ICON: Record<CommandCategory, ReactNode> = {
  template: <FileCode size={13} className="shrink-0 text-primary" />,
  snippet: <Code size={13} className="shrink-0 text-info" />,
  action: <Zap size={13} className="shrink-0 text-warning" />,
};

interface CommandPaletteProps {
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenSnippets: () => void;
}

export function CommandPalette({
  onClose,
  onOpenSettings,
  onOpenSnippets,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { addTab } = useEditorStore();
  const { snippets } = useSnippetsStore();
  const { setLayoutPreset } = useSettingsStore();
  const { checkForUpdates, restartToApply, status: updateStatus } = useUpdateStore();

  const allCommands = useMemo((): Command[] => {
    const commands: Command[] = [];

    for (const template of BUILT_IN_TEMPLATES) {
      commands.push({
        id: `tpl-${template.id}`,
        category: 'template',
        label: template.label,
        description: template.description,
        language: template.language,
        keywords: [template.label, template.language, template.description].map((value) =>
          value.toLowerCase()
        ),
        action: () => {
          const tab = createDefaultTab(template.language);
          addTab({
            ...tab,
            content: template.code,
            name: `${template.label}.${extensionForLanguage(template.language)}`,
          });
          onClose();
        },
      });
    }

    for (const snippet of snippets) {
      commands.push({
        id: `sn-${snippet.id}`,
        category: 'snippet',
        label: snippet.label,
        description: snippet.description || 'Custom snippet',
        language: snippet.language,
        keywords: [snippet.label, snippet.language, snippet.description].map((value) =>
          value.toLowerCase()
        ),
        action: () => {
          const tab = createDefaultTab(snippet.language);
          addTab({
            ...tab,
            content: snippet.code,
            name: `${snippet.label}.${extensionForLanguage(snippet.language)}`,
          });
          onClose();
        },
      });
    }

    commands.push(
      {
        id: 'action-layout-horizontal',
        category: 'action',
        label: 'Layout: Horizontal Split',
        description: 'Editor on top, console below',
        keywords: ['layout', 'horizontal', 'split', 'console'],
        action: () => {
          setLayoutPreset('horizontal');
          onClose();
        },
      },
      {
        id: 'action-layout-vertical',
        category: 'action',
        label: 'Layout: Vertical Split',
        description: 'Editor left, console right',
        keywords: ['layout', 'vertical', 'split'],
        action: () => {
          setLayoutPreset('vertical');
          onClose();
        },
      },
      {
        id: 'action-layout-editor',
        category: 'action',
        label: 'Layout: Editor Only',
        description: 'Hide the console panel',
        keywords: ['layout', 'editor', 'only', 'hide', 'console'],
        action: () => {
          setLayoutPreset('editor-only');
          onClose();
        },
      },
      {
        id: 'action-snippets',
        category: 'action',
        label: 'Open Snippets',
        description: 'Browse, save, edit, and reuse snippets',
        keywords: ['snippets', 'snippet', 'library', 'save snippet'],
        action: () => {
          onClose();
          onOpenSnippets();
        },
      },
      {
        id: 'action-settings',
        category: 'action',
        label: 'Open Settings',
        description: 'Themes, fonts, and preferences',
        keywords: ['settings', 'preferences', 'theme', 'font'],
        action: () => {
          onClose();
          onOpenSettings();
        },
      },
      {
        id: 'action-check-updates',
        category: 'action',
        label: 'Check for Updates',
        description: 'Query the configured desktop update feed',
        keywords: ['updates', 'update', 'release', 'version'],
        action: () => {
          void checkForUpdates();
          onClose();
        },
      },
      {
        id: 'action-restart-update',
        category: 'action',
        label: 'Restart to Apply Update',
        description:
          updateStatus === 'downloaded'
            ? 'Restart now to install the downloaded update'
            : 'Available once an update has been downloaded',
        keywords: ['updates', 'restart', 'apply', 'install'],
        action: () => {
          void restartToApply();
          onClose();
        },
      }
    );

    return commands;
  }, [
    snippets,
    addTab,
    setLayoutPreset,
    onClose,
    onOpenSettings,
    onOpenSnippets,
    checkForUpdates,
    restartToApply,
    updateStatus,
  ]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return allCommands;

    return allCommands.filter(
      (command) =>
        command.keywords.some((keyword) => keyword.includes(normalizedQuery)) ||
        command.label.toLowerCase().includes(normalizedQuery) ||
        command.description.toLowerCase().includes(normalizedQuery)
    );
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search templates, snippets, commands..."
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} className="button-ghost p-1.5">
              <X size={14} />
            </button>
          )}
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[26rem] overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">No results for "{query}"</p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                onClick={command.action}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                  index === selectedIndex
                    ? 'bg-primary-soft'
                    : 'hover:bg-surface-strong/68'
                }`}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-surface-strong/82">
                  {CATEGORY_ICON[command.category]}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {command.label}
                  </span>
                  <span className="truncate text-xs text-muted">{command.description}</span>
                </div>
                {command.language && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${languageBadgeClass(command.language)}`}
                  >
                    {languageShortLabel(command.language)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="surface-header flex items-center gap-4 px-4 py-3 text-[11px] text-muted">
          <span>
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> select
          </span>
          <span className="ml-auto">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
