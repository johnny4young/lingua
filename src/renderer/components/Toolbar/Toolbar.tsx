import {
  BookCopy,
  ChevronDown,
  Loader2,
  PanelBottom,
  PanelLeft,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  Terminal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useRunner } from '../../hooks/useRunner';
import { useUIStore } from '../../stores/uiStore';
import type { Language } from '../../types';
import { languageLabel } from '../../utils/languageMeta';
import { usePluginStore } from '../../stores/pluginStore';
import { IconButton } from '../ui/chrome';

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
  const plugins = usePluginStore((state) => state.plugins);
  const [isNewFileMenuOpen, setIsNewFileMenuOpen] = useState(false);
  const newFileMenuRef = useRef<HTMLDivElement | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
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
    <div className="toolbar-drag-region surface-header relative z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 px-3 py-2 sm:min-h-14 sm:flex-nowrap sm:px-4">
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-32 bg-gradient-to-r from-primary-soft/55 via-transparent to-transparent sm:block" />

      <div className="flex min-w-0 items-center gap-2 pl-[70px] sm:pl-[78px]">
        <IconButton
          onClick={toggleSidebar}
          active={sidebarVisible}
          title="Toggle sidebar (Cmd+B)"
          aria-controls="project-explorer"
          aria-expanded={sidebarVisible}
        >
          <PanelLeft size={15} />
        </IconButton>

        <div className="toolbar-divider" />

        <button
          onClick={run}
          disabled={isRunning || !hasTabs}
          className="button-primary min-w-[7.4rem] justify-center bg-success text-background hover:bg-success/92"
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
          <button onClick={stop} className="button-danger" title="Stop">
            <Square size={11} fill="currentColor" />
            Stop
          </button>
        )}

        <div className="toolbar-divider" />

        <div ref={newFileMenuRef} className="relative flex items-center">
          <button
            onClick={() => handleNewFile(defaultNewFileLanguage)}
            className="button-secondary rounded-r-none border-r-0 pr-3.5"
            title={`New ${defaultNewFileLabel} file`}
          >
            <Plus size={13} />
            {`New ${defaultNewFileLabel}`}
          </button>
          <button
            onClick={() => setIsNewFileMenuOpen((currentValue) => !currentValue)}
            className={`button-secondary rounded-l-none px-2.5 ${
              isNewFileMenuOpen ? 'text-primary' : ''
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
              className="surface-panel-strong absolute left-0 top-[calc(100%+0.55rem)] z-20 min-w-52 p-1.5"
            >
              {languages.map((language) => (
                <button
                  key={language.id}
                  role="menuitem"
                  onClick={() => handleNewFile(language.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                    language.id === defaultNewFileLanguage
                      ? 'bg-primary-soft text-primary'
                      : 'text-foreground hover:bg-surface-strong/78'
                  }`}
                >
                  <span>{language.label}</span>
                  {language.id === defaultNewFileLanguage && (
                    <span className="status-pill border-primary/20 bg-transparent px-0 text-primary">
                      Current
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1">
        {activeTab && (
          <div className="status-pill hidden max-w-[14rem] truncate sm:flex">
            {defaultNewFileLabel} active
          </div>
        )}

        <IconButton onClick={onOpenQuickOpen} title="Go to file (Cmd+P)">
          <Search size={15} />
        </IconButton>
        <IconButton onClick={onOpenPalette} title="Command palette (Cmd+Shift+P)">
          <Terminal size={15} />
        </IconButton>
        <IconButton onClick={onOpenSnippets} title="Snippets">
          <BookCopy size={15} />
        </IconButton>
        <IconButton
          onClick={toggleConsole}
          active={consoleVisible}
          title="Toggle console (Cmd+\\)"
        >
          <PanelBottom size={15} />
        </IconButton>
        <IconButton onClick={onOpenSettings} title="Settings (Cmd+,)">
          <Settings size={15} />
        </IconButton>
      </div>
    </div>
  );
}
