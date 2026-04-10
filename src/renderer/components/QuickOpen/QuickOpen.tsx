import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore, type FileTreeNode } from '../../stores/projectStore';
import type { Language } from '../../types';
import { languageBadgeClass } from '../../utils/languageMeta';
import { Kbd, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { handleCloseOnEscape } from '../ui/keyboard';

interface FileResult {
  name: string;
  path: string;
  language?: Language;
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

  const projectFiles = useMemo<FileResult[]>(() => {
    const results: FileResult[] = [];

    function walk(treeNodes: FileTreeNode[]) {
      for (const node of treeNodes) {
        if (!node.isDirectory) {
          results.push({
            name: node.name,
            path: node.path,
            language: node.language,
            source: 'project',
          });
        } else if (node.children) {
          walk(node.children);
        }
      }
    }

    walk(nodes);
    return results;
  }, [nodes]);

  const allFiles = useMemo<FileResult[]>(() => {
    const openPaths = new Set(tabs.map((tab) => tab.filePath).filter(Boolean) as string[]);

    const openTabs: FileResult[] = tabs.map((tab) => ({
      name: tab.name,
      path: tab.filePath ?? tab.id,
      language: tab.language,
      source: 'open-tab',
    }));

    const projectOnly = projectFiles.filter((file) => !openPaths.has(file.path));
    return [...openTabs, ...projectOnly];
  }, [tabs, projectFiles]);

  const filtered = useMemo<FileResult[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return allFiles;

    return allFiles.filter(
      (file) =>
        file.name.toLowerCase().includes(normalizedQuery) ||
        file.path.toLowerCase().includes(normalizedQuery)
    );
  }, [allFiles, query]);

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

  const select = async (file: FileResult) => {
    if (file.source === 'open-tab') {
      const tab = tabs.find((item) => (item.filePath ?? item.id) === file.path);
      if (tab) setActiveTab(tab.id);
    } else if (file.language) {
      await openFile(file.path, file.name, file.language);
    }

    onClose();
  };

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
      const file = filtered[selectedIndex];
      if (file) {
        void select(file);
      }
      return;
    }

    handleCloseOnEscape(event, onClose);
  };

  return (
    <OverlayBackdrop align="top" onClose={onClose}>
      <OverlayCard className="w-full max-w-xl">
        <div className="surface-header flex items-center gap-3 px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to file..."
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {allFiles.length === 0
                ? 'No files open. Open a project to browse files.'
                : `No files match "${query}"`}
            </p>
          ) : (
            filtered.map((file, index) => (
              <button
                key={file.path}
                onClick={() => void select(file)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                  index === selectedIndex
                    ? 'bg-primary-soft'
                    : 'hover:bg-surface-strong/68'
                }`}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
                  {file.path !== file.name && (
                    <span className="truncate text-xs text-muted">{file.path}</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {file.source === 'open-tab' && <span className="status-pill">Open</span>}
                  {file.language && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${languageBadgeClass(file.language)}`}
                    >
                      {file.language}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="surface-header flex items-center gap-4 px-4 py-3 text-[11px] text-muted">
          <span>
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto">{filtered.length} files</span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
