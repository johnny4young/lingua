import {
  Play,
  Square,
  Plus,
  Settings,
  Loader2,
  Terminal,
  Search,
  PanelLeft,
  PanelBottom,
} from 'lucide-react';
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
}

export function Toolbar({ onOpenSettings, onOpenPalette, onOpenQuickOpen }: ToolbarProps) {
  const { tabs, activeTabId, addTab } = useEditorStore();
  const { run, stop, isRunning, isInitializing, loadingMessage } = useRunner();
  const { sidebarVisible, consoleVisible, toggleSidebar, toggleConsole } = useUIStore();
  const plugins = usePluginStore((s) => s.plugins);
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

  const handleNewFile = (language: Language) => {
    const tab = createDefaultTab(language);
    addTab(tab);
  };

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
        {hasTabs && (
          <>
            <div className="mx-1 h-4 w-px bg-gray-800/60" />
            <select
              value={activeTab?.language ?? 'javascript'}
              onChange={(e) => handleNewFile(e.target.value as Language)}
              className="rounded-md border border-gray-700/50 bg-gray-800/60 px-2 py-1 text-xs text-gray-400 outline-none transition-colors focus:border-primary-500/50 hover:bg-gray-800"
            >
              {languages.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </select>
          </>
        )}
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
          onClick={() => handleNewFile(activeTab?.language ?? 'javascript')}
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title="New file"
        >
          <Plus size={15} />
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
