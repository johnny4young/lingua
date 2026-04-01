import { Play, Square, Plus, Settings, Loader2 } from 'lucide-react';
import { useEditorStore, createDefaultTab } from '../../stores/editorStore';
import { useRunner } from '../../hooks/useRunner';
import type { Language } from '../../types';

const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'python', label: 'Python' },
  { id: 'rust', label: 'Rust' },
];

export function Toolbar() {
  const { tabs, activeTabId, addTab } = useEditorStore();
  const { run, stop, isRunning, isInitializing, loadingMessage } = useRunner();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleNewFile = (language: Language) => {
    const tab = createDefaultTab(language);
    addTab(tab);
  };

  return (
    <div className="flex h-10 items-center justify-between border-b border-gray-800 bg-gray-900 px-3">
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={isRunning}
          className="flex items-center gap-1.5 rounded bg-success-500/20 px-3 py-1 text-xs font-medium text-success-500 transition-colors hover:bg-success-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          title="Run (Cmd+Enter)"
        >
          {isInitializing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          {loadingMessage ?? (isRunning ? 'Running...' : 'Run')}
        </button>
        <button
          onClick={stop}
          disabled={!isRunning}
          className="flex items-center gap-1.5 rounded bg-error-500/20 px-3 py-1 text-xs font-medium text-error-500 transition-colors hover:bg-error-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          title="Stop"
        >
          <Square size={14} />
          Stop
        </button>
        <div className="mx-2 h-5 w-px bg-gray-800" />
        <select
          value={activeTab?.language ?? 'javascript'}
          onChange={(e) => handleNewFile(e.target.value as Language)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 outline-none focus:border-primary-500"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.id} value={lang.id}>
              {lang.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleNewFile(activeTab?.language ?? 'javascript')}
          className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title="New file"
        >
          <Plus size={16} />
        </button>
        <button
          className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title="Settings (Cmd+,)"
        >
          <Settings size={16} />
        </button>
      </div>
    </div>
  );
}
