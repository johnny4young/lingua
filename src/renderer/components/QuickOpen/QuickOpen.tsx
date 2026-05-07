import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import {
  useProjectIndexStore,
  type ProjectIndexEntry,
} from '../../stores/projectIndexStore';
import { useProjectStore, type FileTreeNode } from '../../stores/projectStore';
import { useRecentFilesStore } from '../../stores/recentFilesStore';
import { PLAINTEXT_LANGUAGE } from '../../utils/language';
import { joinAbsolute, parentDirOf } from '../../utils/filePath';
import type { Language } from '../../types';
import { languageBadgeClass } from '../../utils/languageMeta';
import { Kbd, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { handleCloseOnEscape } from '../ui/keyboard';

interface FileResult {
  name: string;
  path: string;
  language?: Language;
  source: 'open-tab' | 'recent' | 'project';
}

interface QuickOpenProps {
  onClose: () => void;
}

export function QuickOpen({ onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { t } = useTranslation();
  const { tabs, setActiveTab, openFile } = useEditorStore();
  const { nodes } = useProjectStore();
  const { recentFiles } = useRecentFilesStore();
  const indexEntries = useProjectIndexStore((state) => state.entries);
  const indexStatus = useProjectIndexStore((state) => state.status);

  const projectFiles = useMemo<FileResult[]>(() => {
    // Prefer the project-wide index when it's ready — it covers every file in
    // the project root, not only the expanded portion of the tree. We only
    // fall back to the tree walk when the index hasn't produced results yet
    // (first paint on project open, or runtimes without listAllFiles) so the
    // feature never hard-fails, it just degrades.
    if (indexStatus === 'ready' && indexEntries.length > 0) {
      return indexEntries.map<FileResult>((entry: ProjectIndexEntry) => ({
        name: entry.name,
        path: entry.relativePath,
        language: entry.language,
        source: 'project',
      }));
    }

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
  }, [indexEntries, indexStatus, nodes]);

  const allFiles = useMemo<FileResult[]>(() => {
    const openPaths = new Set(tabs.map((tab) => tab.filePath).filter(Boolean) as string[]);

    const openTabs: FileResult[] = tabs.map((tab) => ({
      name: tab.name,
      path: tab.filePath ?? tab.id,
      language: tab.language,
      source: 'open-tab',
    }));

    const recentOnly: FileResult[] = recentFiles
      .filter((f) => !openPaths.has(f.filePath))
      .map((f) => ({
        name: f.name,
        path: f.filePath,
        language: f.language,
        source: 'recent',
      }));

    const seenPaths = new Set([...openPaths, ...recentOnly.map((f) => f.path)]);
    const projectOnly = projectFiles.filter((file) => !seenPaths.has(file.path));
    return [...openTabs, ...recentOnly, ...projectOnly];
  }, [tabs, projectFiles, recentFiles]);

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
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${selectedIndex}"]`
    );
    element?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const select = async (file: FileResult) => {
    if (file.source === 'open-tab') {
      const tab = tabs.find((item) => (item.filePath ?? item.id) === file.path);
      if (tab) setActiveTab(tab.id);
      onClose();
      return;
    }

    if (file.source === 'project') {
      // Project files: rootId comes from the active project's capability;
      // file.path is already the relative path inside that root.
      const { currentProject } = useProjectStore.getState();
      if (!currentProject) {
        onClose();
        return;
      }
      const displayPath = joinAbsolute(currentProject.rootPath, file.path);
      await openFile(
        currentProject.rootId,
        file.path,
        file.name,
        file.language ?? PLAINTEXT_LANGUAGE,
        displayPath
      );
      onClose();
      return;
    }

    // Recent files have an absolute path from a previous session. Re-mint
    // a capability for the parent directory and open under the new
    // contract so the renderer never hands main an absolute path.
    const { parent, basename } = parentDirOf(file.path);
    const reopen = await window.lingua.fs.reopenRoot(parent);
    if (!reopen.ok) {
      onClose();
      return;
    }
    await openFile(
      reopen.rootId,
      basename,
      file.name,
      file.language ?? PLAINTEXT_LANGUAGE,
      file.path
    );
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
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.item.quickOpen.label')}
        className="w-full max-w-xl"
      >
        <div className="surface-header flex items-center gap-3 px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('quickOpen.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <p className="text-sm text-muted">
                {allFiles.length === 0
                  ? t('quickOpen.empty.noProject')
                  : t('quickOpen.empty.noMatch', { query })}
              </p>
              {allFiles.length === 0 && (
                <p className="text-xs text-muted/80">
                  {t('quickOpen.empty.noProject.hint')}
                </p>
              )}
              {allFiles.length > 0 && (
                <p className="text-xs text-muted/80">
                  {t('quickOpen.empty.noMatch.hint')}
                </p>
              )}
            </div>
          ) : (
            renderQuickOpenResults(filtered, query, selectedIndex, setSelectedIndex, select, t)
          )}
        </div>

        <div className="surface-header flex items-center gap-4 px-4 py-3 text-[11px] text-muted">
          <span>
            <Kbd>↑↓</Kbd> {t('quickOpen.hint.navigate')}
          </span>
          <span>
            <Kbd>↵</Kbd> {t('quickOpen.hint.open')}
          </span>
          <span className="ml-auto">
            {t('quickOpen.count', { count: filtered.length })}
          </span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}

/**
 * Section order for the empty-query overview. Open tabs first because
 * the user is most likely jumping back to something already on screen,
 * recent files second for "what I touched yesterday", project tail
 * last as the catalog. On any non-empty query the renderer flattens to
 * a single ranked list so search results are not split across sections.
 */
const QUICK_OPEN_SECTION_ORDER: readonly FileResult['source'][] = [
  'open-tab',
  'recent',
  'project',
];

const QUICK_OPEN_SECTION_LABEL_KEY: Record<FileResult['source'], string> = {
  'open-tab': 'quickOpen.scope.openTabs',
  recent: 'quickOpen.scope.recent',
  project: 'quickOpen.scope.project',
};

function renderQuickOpenResults(
  filtered: FileResult[],
  query: string,
  selectedIndex: number,
  setSelectedIndex: (index: number) => void,
  select: (file: FileResult) => Promise<void>,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const isEmptyQuery = query.trim().length === 0;
  const renderRow = (file: FileResult, index: number) => (
    <button
      key={file.path}
      onClick={() => void select(file)}
      onMouseEnter={() => setSelectedIndex(index)}
      data-result-index={index}
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
        {file.source === 'open-tab' && (
          <span className="status-pill">{t('quickOpen.badge.open')}</span>
        )}
        {file.source === 'recent' && (
          <span className="status-pill">{t('quickOpen.badge.recent')}</span>
        )}
        {file.language && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${languageBadgeClass(file.language)}`}
          >
            {file.language}
          </span>
        )}
      </div>
    </button>
  );

  if (!isEmptyQuery) {
    return filtered.map((file, index) => renderRow(file, index));
  }

  // Bucket while preserving original index so keyboard navigation
  // (which steps through `filtered` linearly) keeps highlighting the
  // right entry — sections are a render-time concern only, not a
  // data restructure.
  const buckets: Record<FileResult['source'], Array<{ file: FileResult; index: number }>> = {
    'open-tab': [],
    recent: [],
    project: [],
  };
  filtered.forEach((file, index) => {
    buckets[file.source].push({ file, index });
  });

  return QUICK_OPEN_SECTION_ORDER.flatMap((source) => {
    const bucket = buckets[source];
    if (bucket.length === 0) return [];
    return [
      <p
        key={`section-${source}`}
        className="panel-title px-3 pt-3 pb-1.5"
        role="presentation"
      >
        {t(QUICK_OPEN_SECTION_LABEL_KEY[source])}
      </p>,
      ...bucket.map(({ file, index }) => renderRow(file, index)),
    ];
  });
}
