import { X, Search, Code, Zap, FileCode } from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { BUILT_IN_TEMPLATES } from '../../data/templates';
import { useSnippetsStore } from '../../stores/snippetsStore';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUpdateStore } from '../../stores/updateStore';
import type { Language } from '../../types';
import { extensionForLanguage, languageBadgeClass, languageShortLabel } from '../../utils/languageMeta';

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

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

// Language badge colors
const CATEGORY_ICON: Record<CommandCategory, React.ReactNode> = {
  template: <FileCode size={13} className="shrink-0 text-violet-400" />,
  snippet:  <Code size={13} className="shrink-0 text-blue-400" />,
  action:   <Zap size={13} className="shrink-0 text-yellow-400" />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

  // Build full command list
  const allCommands = useMemo((): Command[] => {
    const cmds: Command[] = [];

    // Built-in templates
    for (const tpl of BUILT_IN_TEMPLATES) {
      cmds.push({
        id: `tpl-${tpl.id}`,
        category: 'template',
        label: tpl.label,
        description: tpl.description,
        language: tpl.language,
        keywords: [tpl.label, tpl.language, tpl.description].map((s) => s.toLowerCase()),
        action: () => {
          const tab = createDefaultTab(tpl.language);
          addTab({
            ...tab,
            content: tpl.code,
            name: `${tpl.label}.${extensionForLanguage(tpl.language)}`,
          });
          onClose();
        },
      });
    }

    // Custom snippets
    for (const sn of snippets) {
      cmds.push({
        id: `sn-${sn.id}`,
        category: 'snippet',
        label: sn.label,
        description: sn.description || 'Custom snippet',
        language: sn.language,
        keywords: [sn.label, sn.language, sn.description].map((s) => s.toLowerCase()),
        action: () => {
          const tab = createDefaultTab(sn.language);
          addTab({
            ...tab,
            content: sn.code,
            name: `${sn.label}.${extensionForLanguage(sn.language)}`,
          });
          onClose();
        },
      });
    }

    // General actions
    cmds.push(
      {
        id: 'action-layout-horizontal',
        category: 'action',
        label: 'Layout: Horizontal Split',
        description: 'Editor on top, console below',
        keywords: ['layout', 'horizontal', 'split', 'console'],
        action: () => { setLayoutPreset('horizontal'); onClose(); },
      },
      {
        id: 'action-layout-vertical',
        category: 'action',
        label: 'Layout: Vertical Split',
        description: 'Editor left, console right',
        keywords: ['layout', 'vertical', 'split'],
        action: () => { setLayoutPreset('vertical'); onClose(); },
      },
      {
        id: 'action-layout-editor',
        category: 'action',
        label: 'Layout: Editor Only',
        description: 'Hide the console panel',
        keywords: ['layout', 'editor', 'only', 'hide', 'console'],
        action: () => { setLayoutPreset('editor-only'); onClose(); },
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
        action: () => { onClose(); onOpenSettings(); },
      },
      {
        id: 'action-check-updates',
        category: 'action',
        label: 'Check for Updates',
        description: 'Query the configured desktop update feed',
        keywords: ['updates', 'update', 'release', 'version'],
        action: () => { void checkForUpdates(); onClose(); },
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
        action: () => { void restartToApply(); onClose(); },
      },
    );

    return cmds;
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

  // Filter by query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter((c) =>
      c.keywords.some((kw) => kw.includes(q)) ||
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    );
  }, [allCommands, query]);

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[selectedIndex]?.action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2.5">
          <Search size={15} className="shrink-0 text-gray-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search templates, snippets, commands..."
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-600 hover:text-gray-400">
              <X size={14} />
            </button>
          )}
          <kbd className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-600">No results for "{query}"</p>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={cmd.action}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  i === selectedIndex ? 'bg-primary-500/15' : 'hover:bg-gray-800/60'
                }`}
              >
                {CATEGORY_ICON[cmd.category]}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-gray-200">{cmd.label}</span>
                  <span className="truncate text-xs text-gray-500">{cmd.description}</span>
                </div>
                {cmd.language && (
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${languageBadgeClass(cmd.language)}`}>
                    {languageShortLabel(cmd.language)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-gray-800 px-3 py-2">
          <span className="text-[10px] text-gray-600">
            <kbd className="rounded bg-gray-800 px-1 py-0.5">↑↓</kbd> navigate
          </span>
          <span className="text-[10px] text-gray-600">
            <kbd className="rounded bg-gray-800 px-1 py-0.5">↵</kbd> select
          </span>
          <span className="text-[10px] text-gray-600">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
