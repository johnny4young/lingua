import {
  Play,
  Square,
  Plus,
  ChevronDown,
  Settings,
  Loader2,
  Terminal,
  Search,
  BookCopy,
  PanelLeft,
  PanelBottom,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useRunner } from '../../hooks/useRunner';
import { useUIStore } from '../../stores/uiStore';
import type { Language } from '../../types';
import { languageLabel } from '../../utils/languageMeta';
import { usePluginStore } from '../../stores/pluginStore';

const BUILT_IN_LANGUAGES: { id: Language; label: string }[] = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'python', label: 'Python' },
  { id: 'rust', label: 'Rust' },
];

interface ToolbarProps {
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
}

export function Toolbar({
  onOpenSettings,
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
}: ToolbarProps) {
  const { tabs, activeTabId, addTab } = useEditorStore();
  const { run, stop, isRunning, isInitializing, loadingMessage } = useRunner();
  const { sidebarVisible, consoleVisible, toggleSidebar, toggleConsole } = useUIStore();
  const plugins = usePluginStore((s) => s.plugins);
  const [isNewFileMenuOpen, setIsNewFileMenuOpen] = useState(false);
  const newFileMenuRef = useRef<HTMLDivElement | null>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const hasTabs = tabs.length > 0;
  const languages = [
    ...BUILT_IN_LANGUAGES,
    ...plugins
      .filter((plugin) => plugin.status === 'loaded' && plugin.language)
      .map((plugin) => ({
        id: plugin.language as Language,
        label: languageLabel(plugin.language as Language),
      })),
  ];
  const defaultNewFileLanguage = activeTab?.language ?? 'javascript';
  const defaultNewFileLabel = languageLabel(defaultNewFileLanguage);

  const handleNewFile = (language: Language) => {
    const tab = createDefaultTab(language);
    addTab(tab);
    setIsNewFileMenuOpen(false);
  };

  useEffect(() => {
    if (!isNewFileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const menuElement = newFileMenuRef.current;
      if (!menuElement || menuElement.contains(event.target as Node)) {
        return;
      }

      setIsNewFileMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNewFileMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNewFileMenuOpen]);

  return (
    <div className="toolbar-drag-region flex h-11 items-center justify-between border-b border-gray-800/60 bg-gray-900/80 backdrop-blur-sm px-3">
      {/* Left: macOS traffic-light spacer + actions */}
      <div className="flex items-center gap-2 pl-[70px]">
        <button
          onClick={toggleSidebar}
          className={`rounded p-1.5 transition-colors ${
            sidebarVisible
              ? 'text-primary-400 bg-primary-500/10'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title="Toggle sidebar (Cmd+B)"
        >
          <PanelLeft size={15} />
        </button>
        <div className="mx-1 h-4 w-px bg-gray-800/60" />
        <button
          onClick={run}
          disabled={isRunning || !hasTabs}
          className="flex items-center gap-1.5 rounded-md bg-success-500/15 px-3 py-1.5 text-xs font-medium text-success-500 transition-all hover:bg-success-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          title="Run (Cmd+Enter)"
        >
          {isInitializing ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Play size={13} fill="currentColor" />
          )}
          {loadingMessage ?? (isRunning ? 'Running...' : 'Run')}
        </button>
        {isRunning && (
          <button
            onClick={stop}
            className="flex items-center gap-1.5 rounded-md bg-error-500/15 px-3 py-1.5 text-xs font-medium text-error-500 transition-all hover:bg-error-500/25"
            title="Stop"
          >
            <Square size={11} fill="currentColor" />
            Stop
          </button>
        )}
        <div className="mx-1 h-4 w-px bg-gray-800/60" />
        <div ref={newFileMenuRef} className="relative flex items-center">
          <button
            onClick={() => handleNewFile(defaultNewFileLanguage)}
            className="flex items-center gap-1.5 rounded-l-md border border-gray-700/50 bg-gray-800/60 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
            title={`New ${defaultNewFileLabel} file`}
          >
            <Plus size={13} />
            {`New ${defaultNewFileLabel}`}
          </button>
          <button
            onClick={() => setIsNewFileMenuOpen((currentValue) => !currentValue)}
            className={`rounded-r-md border border-l-0 border-gray-700/50 bg-gray-800/60 px-2 py-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-300 ${
              isNewFileMenuOpen ? 'text-primary-400' : ''
            }`}
            title="Choose language for new file"
            aria-haspopup="menu"
            aria-expanded={isNewFileMenuOpen}
          >
            <ChevronDown size={13} />
          </button>

          {isNewFileMenuOpen && (
            <div
              role="menu"
              aria-label="New file language menu"
              className="absolute top-[calc(100%+0.35rem)] left-0 z-20 min-w-44 rounded-md border border-gray-800/80 bg-gray-900/95 p-1 shadow-2xl backdrop-blur-sm"
            >
              {languages.map((lang) => (
                <button
                  key={lang.id}
                  role="menuitem"
                  onClick={() => handleNewFile(lang.id)}
                  className={`flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-xs transition-colors ${
                    lang.id === defaultNewFileLanguage
                      ? 'bg-primary-500/10 text-primary-300'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                  }`}
                >
                  <span>{lang.label}</span>
                  {lang.id === defaultNewFileLanguage && (
                    <span className="text-[10px] uppercase tracking-wide text-primary-400">
                      Current
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: utility buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onOpenQuickOpen}
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title="Go to file (Cmd+P)"
        >
          <Search size={15} />
        </button>
        <button
          onClick={onOpenPalette}
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title="Command palette (Cmd+Shift+P)"
        >
          <Terminal size={15} />
        </button>
        <button
          onClick={onOpenSnippets}
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title="Snippets"
        >
          <BookCopy size={15} />
        </button>
        <button
          onClick={toggleConsole}
          className={`rounded-md p-1.5 transition-colors ${
            consoleVisible
              ? 'text-primary-400 bg-primary-500/10'
              : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
          title="Toggle console (Cmd+\)"
        >
          <PanelBottom size={15} />
        </button>
        <button
          onClick={onOpenSettings}
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title="Settings (Cmd+,)"
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
