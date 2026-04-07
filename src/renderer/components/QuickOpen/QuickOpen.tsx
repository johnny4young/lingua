import { Search } from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore, type FileTreeNode } from '../../stores/projectStore';
import type { Language } from '../../types';
import { languageBadgeClass } from '../../utils/languageMeta';

interface FileResult {
  name: string;
  path: string;
  language?: Language;
  /** Where the file came from */
  source: 'open-tab' | 'project';
}

interface QuickOpenProps {
  onClose: () => void;
}

export function QuickOpen({ onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { tabs, setActiveTab, openFile } = useEditorStore();
  const { nodes } = useProjectStore();

  // Flatten the project file tree
  const projectFiles = useMemo<FileResult[]>(() => {
    const results: FileResult[] = [];
    function walk(treeNodes: FileTreeNode[]) {
      for (const node of treeNodes) {
        if (!node.isDirectory) {
          results.push({ name: node.name, path: node.path, language: node.language, source: 'project' });
        } else if (node.children) {
          walk(node.children);
        }
      }
    }
    walk(nodes);
    return results;
  }, [nodes]);

  // Build combined list: open tabs first, then project files not already open
  const allFiles = useMemo<FileResult[]>(() => {
    const openPaths = new Set(tabs.map((t) => t.filePath).filter(Boolean) as string[]);

    const fromTabs: FileResult[] = tabs.map((t) => ({
      name: t.name,
      path: t.filePath ?? t.id,
      language: t.language,
      source: 'open-tab' as const,
    }));

    const fromProject: FileResult[] = projectFiles.filter((f) => !openPaths.has(f.path));

    return [...fromTabs, ...fromProject];
  }, [tabs, projectFiles]);

  // Filter by query
  const filtered = useMemo<FileResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allFiles;
    return allFiles.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [allFiles, query]);

  useEffect(() => { setSelectedIndex(0); }, [filtered.length]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const select = async (file: FileResult) => {
    if (file.source === 'open-tab') {
      // Find the tab by name/path and activate it
      const tab = tabs.find((t) => (t.filePath ?? t.id) === file.path);
      if (tab) setActiveTab(tab.id);
    } else if (file.language) {
      // Open from disk
      await openFile(file.path, file.name, file.language);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const f = filtered[selectedIndex];
      if (f) select(f);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Input */}
        <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2.5">
          <Search size={15} className="shrink-0 text-gray-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to file..."
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none"
          />
          <kbd className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-600">
              {allFiles.length === 0
                ? 'No files open. Open a project to browse files.'
                : `No files match "${query}"`}
            </p>
          ) : (
            filtered.map((file, i) => (
              <button
                key={file.path}
                onClick={() => select(file)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  i === selectedIndex ? 'bg-primary-500/15' : 'hover:bg-gray-800/60'
                }`}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-gray-200">{file.name}</span>
                  {file.path !== file.name && (
                    <span className="truncate text-xs text-gray-600">{file.path}</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {file.source === 'open-tab' && (
                    <span className="text-[10px] text-gray-600">open</span>
                  )}
                  {file.language && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${languageBadgeClass(file.language)}`}>
                      {file.language}
                    </span>
                  )}
                </div>
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
            <kbd className="rounded bg-gray-800 px-1 py-0.5">↵</kbd> open
          </span>
          <span className="ml-auto text-[10px] text-gray-600">{filtered.length} files</span>
        </div>
      </div>
    </div>
  );
}
