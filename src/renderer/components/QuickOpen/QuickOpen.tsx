import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import {
  useProjectIndexStore,
  type ProjectIndexEntry,
} from '../../stores/projectIndexStore';
import { useProjectStore, type FileTreeNode } from '../../stores/projectStore';
import { useRecentFilesStore } from '../../stores/recentFilesStore';
import { notifyBlockedPath } from '../../utils/blockedPath';
import { PLAINTEXT_LANGUAGE } from '../../utils/language';
import { joinAbsolute } from '../../utils/filePath';
import type { Language } from '../../types/language';
import { languageBadgeClass } from '../../utils/languageMeta';
import { EmptyState } from '../ui/EmptyState';
import { Kbd, ModalShell } from '../ui/ModalShell';
import { ModalFooterLegend } from '../ui/ModalFooterLegend';
import { StatusBadge } from '../ui/StatusBadge';
import { getQuickOpenScope, matchesQuickOpenTerms, type QuickOpenScopeItem } from '../../utils/quickOpenScope';

interface FileResult {
  name: string;
  /** Disk path; empty for unsaved tabs, which open by `tabId`. */
  path: string;
  /** Second line; defaults to `path`. */
  detail?: string;
  tabId?: string;
  language?: Language;
  // Drives both result ordering and the open path: existing tabs activate by
  // id, recent files reopen through the approved-file bridge, and project
  // files open relative to the current root capability.
  source: 'open-tab' | 'recent' | 'project';
}

function unsavedDetail(
  lastEditedAt: number | undefined,
  now: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (lastEditedAt === undefined) return t('quickOpen.unsaved');
  const minutes = Math.floor(Math.max(0, now - lastEditedAt) / 60_000);
  const ago =
    minutes < 1
      ? t('quickOpen.ago.justNow')
      : minutes < 60
        ? t('quickOpen.ago.minutes', { count: minutes })
        : minutes < 1440
          ? t('quickOpen.ago.hours', { count: Math.floor(minutes / 60) })
          : t('quickOpen.ago.days', { count: Math.floor(minutes / 1440) });
  return t('quickOpen.unsavedEdited', { ago });
}

type QuickOpenRow = { type: 'object'; item: QuickOpenScopeItem } | { type: 'file'; file: FileResult };

/** Workspace rows shown at most, ahead of the files. */
const MAX_SCOPE_ROWS = 50;

interface QuickOpenProps {
  onClose: () => void;
}

export function QuickOpen({ onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // "edited N min ago" is relative to when the overlay opened.
  const [openedAt] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  // accessibility pass — combobox/listbox semantics: the input is the combobox,
  // the results are its listbox, and aria-activedescendant points at the
  // active option so a screen reader announces the highlighted row as the
  // user arrows through (focus stays in the input).
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  const { t } = useTranslation();
  // Read once: the rows describe the workspace as it was when Quick Open opened.
  const [scope] = useState(getQuickOpenScope);
  const [scopeItems] = useState(() => scope?.items() ?? []);
  const { tabs, setActiveTab, openFile } = useEditorStore(
    useShallow((state) => ({
      tabs: state.tabs,
      setActiveTab: state.setActiveTab,
      openFile: state.openFile,
    }))
  );
  const nodes = useProjectStore((state) => state.nodes);
  const projectRootId = useProjectStore((state) => state.currentProject?.rootId);
  const recentFiles = useRecentFilesStore((state) => state.recentFiles);
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

    // Order is intentional: open tabs win, recent files fill in previous
    // context, and indexed project files provide the long tail. Later buckets
    // are deduped so a path never appears with two different open semantics.
    const now = openedAt;
    const openTabs: FileResult[] = tabs.map((tab) => ({
      name: tab.name,
      path: tab.filePath ?? '',
      // Project-relative only for project files; a single-file open keeps its full path.
      detail: tab.filePath
        ? tab.relativePath && tab.rootId !== undefined && tab.rootId === projectRootId
          ? tab.relativePath
          : tab.filePath
        : unsavedDetail(tab.lastEditedAt, now, t),
      tabId: tab.id,
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
  }, [tabs, projectFiles, recentFiles, t, openedAt, projectRootId]);

  const filtered = useMemo<FileResult[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return allFiles;

    return allFiles.filter(
      (file) =>
        file.name.toLowerCase().includes(normalizedQuery) ||
        file.path.toLowerCase().includes(normalizedQuery)
    );
  }, [allFiles, query]);

  const rows = useMemo<QuickOpenRow[]>(
    () => [
      ...scopeItems
        .filter((item) => matchesQuickOpenTerms(query, item.name, item.detail))
        .slice(0, MAX_SCOPE_ROWS)
        .map((item) => ({ type: 'object' as const, item })),
      ...filtered.map((file) => ({ type: 'file' as const, file })),
    ],
    [scopeItems, query, filtered]
  );

  const activeSelectedIndex =
    rows.length === 0 ? 0 : Math.min(selectedIndex, rows.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${activeSelectedIndex}"]`
    );
    element?.scrollIntoView({ block: 'nearest' });
  }, [activeSelectedIndex]);

  const select = async (file: FileResult) => {
    if (file.source === 'open-tab') {
      if (file.tabId) setActiveTab(file.tabId);
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

    // Recent files have an absolute path from a previous session. Main
    // reopens only the approved file, not the whole parent directory.
    const reopen = await window.lingua.fs.reopenFile(file.path);
    if (!reopen.ok) {
      if (reopen.error === 'blocked') void notifyBlockedPath(file.path);
      onClose();
      return;
    }
    await openFile(
      reopen.rootId,
      reopen.fileRelativePath,
      file.name,
      file.language ?? PLAINTEXT_LANGUAGE,
      file.path
    );
    onClose();
  };

  // The overlay closes first, so an action that focuses the editor keeps the focus.
  const activate = (row: QuickOpenRow, action: 'open' | 'structure' | 'insert' = 'open') => {
    if (row.type === 'file') {
      void select(row.file);
      return;
    }
    onClose();
    (row.item[action] ?? row.item.open)();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Clamp instead of wrapping so keyboard navigation matches the visible
      // top-to-bottom order in both sectioned and filtered modes.
      setSelectedIndex((currentIndex) => Math.min(currentIndex + 1, rows.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((currentIndex) => Math.max(currentIndex - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[activeSelectedIndex];
      if (row) activate(row, event.metaKey || event.ctrlKey ? 'structure' : event.altKey ? 'insert' : 'open');
      return;
    }

    // Escape closing is owned by ModalShell's scrim/key handler; the
    // surrounding shell catches it even while the input is focused.
  };

  return (
    <ModalShell
      onClose={onClose}
      icon={<Search size={16} aria-hidden="true" />}
      labelledById={labelId}
      headerClose="esc"
      header={
        <>
          <span id={labelId} className="sr-only">
            {t('shortcuts.item.quickOpen.label')}
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('quickOpen.placeholder')}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              rows.length > 0 ? optionId(activeSelectedIndex) : undefined
            }
            className="min-w-0 flex-1 bg-transparent text-body text-fg-base outline-none placeholder:text-fg-subtle"
          />
        </>
      }
      footerLegend={
        scope ? (
          <div data-testid="quick-open-scope-legend" className="flex min-w-0 flex-1 items-center gap-[14px] text-caption text-fg-subtle">
            {scope.legend.map(([glyph, label]) => (
              <span key={glyph} className="flex shrink-0 items-center gap-[6px]">
                <Kbd>{glyph}</Kbd>
                {label}
              </span>
            ))}
            {scope.note ? <span className="ml-auto truncate pr-4">{scope.note}</span> : null}
          </div>
        ) : (
          <ModalFooterLegend navigate open select={false} close={false} />
        )
      }
      trailing={
        // accessibility pass — polite live region so the result count is announced
        // to screen readers as the query narrows (covers the empty state too).
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="quick-open-result-count"
          className="font-mono text-caption text-fg-subtle"
        >
          {scope ? scope.countLabel(rows.length) : t('quickOpen.count', { count: rows.length })}
        </span>
      }
    >
      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={t('shortcuts.item.quickOpen.label')}
      >
        {rows.length === 0 ? (
          <EmptyState
            className="py-10"
            icon={<Search size={18} aria-hidden="true" />}
            title={
              allFiles.length === 0 && scopeItems.length === 0
                ? t('quickOpen.empty.noProject')
                : t('quickOpen.empty.noMatch', { query })
            }
            description={
              allFiles.length === 0 && scopeItems.length === 0
                ? t('quickOpen.empty.noProject.hint')
                : t('quickOpen.empty.noMatch.hint')
            }
          />
        ) : (
          renderQuickOpenResults(
            rows,
            query,
            activeSelectedIndex,
            setSelectedIndex,
            activate,
            t,
            optionId,
            scope?.title
          )
        )}
      </div>
    </ModalShell>
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
  rows: QuickOpenRow[],
  query: string,
  selectedIndex: number,
  setSelectedIndex: (index: number) => void,
  activate: (row: QuickOpenRow) => void,
  t: (key: string, options?: Record<string, unknown>) => string,
  optionId: (index: number) => string,
  scopeTitle: string | undefined
) {
  const isEmptyQuery = query.trim().length === 0;
  const rowClass = (index: number) =>
    `focus-ring flex w-full items-center gap-3 rounded-lg border px-3 py-[9px] text-left transition-colors ${
      index === selectedIndex ? 'border-accent/40 bg-primary-soft' : 'border-transparent hover:bg-bg-panel-alt'
    }`;
  const renderObject = (item: QuickOpenScopeItem, index: number) => (
    <button
      key={`object:${item.id}`}
      id={optionId(index)}
      role="option"
      aria-selected={index === selectedIndex}
      tabIndex={-1}
      onClick={() => activate({ type: 'object', item })}
      onMouseEnter={() => setSelectedIndex(index)}
      data-result-index={index}
      data-testid="quick-open-object"
      className={rowClass(index)}
    >
      <span className="min-w-16 shrink-0 font-mono text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">{item.badge}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-body-sm text-fg-base">{item.name}</span>
      <span className="max-w-[40%] shrink-0 truncate font-mono text-caption text-fg-subtle">{item.detail}</span>
    </button>
  );
  const renderRow = (file: FileResult, index: number) => (
    <button
      key={file.tabId ?? `${file.source}:${file.path}`}
      id={optionId(index)}
      role="option"
      aria-selected={index === selectedIndex}
      // The combobox input is the single tab stop; options are reached via
      // the arrow keys + aria-activedescendant, not the Tab sequence.
      tabIndex={-1}
      onClick={() => activate({ type: 'file', file })}
      onMouseEnter={() => setSelectedIndex(index)}
      data-result-index={index}
      className={rowClass(index)}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-fg-base">{file.name}</span>
        {(file.detail ?? file.path) && (file.detail ?? file.path) !== file.name ? (
          <span className="truncate text-body-sm text-fg-subtle">{file.detail ?? file.path}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {file.source === 'recent' && (
          <StatusBadge tone="neutral">{t('quickOpen.badge.recent')}</StatusBadge>
        )}
        {file.language && (
          <span
            className={`rounded-full px-2 py-0.5 text-eyebrow font-bold uppercase tracking-[0.14em] ${languageBadgeClass(file.language)}`}
          >
            {file.language}
          </span>
        )}
      </div>
    </button>
  );
  const render = (row: QuickOpenRow, index: number) =>
    row.type === 'object' ? renderObject(row.item, index) : renderRow(row.file, index);
  const sectionLabel = (key: string, label: string) => (
    <p
      key={`section-${key}`}
      className="px-3 pb-1.5 pt-3 font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle"
      role="presentation"
    >
      {label}
    </p>
  );

  if (!isEmptyQuery) {
    return rows.map(render);
  }

  // Bucket while preserving original index so keyboard navigation
  // (which steps through `rows` linearly) keeps highlighting the
  // right entry — sections are a render-time concern only, not a
  // data restructure.
  const objects: Array<{ row: QuickOpenRow; index: number }> = [];
  const buckets: Record<FileResult['source'], Array<{ row: QuickOpenRow; index: number }>> = {
    'open-tab': [],
    recent: [],
    project: [],
  };
  rows.forEach((row, index) => {
    if (row.type === 'object') objects.push({ row, index });
    else buckets[row.file.source].push({ row, index });
  });

  return [
    ...(objects.length > 0 && scopeTitle
      ? [sectionLabel('objects', scopeTitle), ...objects.map(({ row, index }) => render(row, index))]
      : objects.map(({ row, index }) => render(row, index))),
    ...QUICK_OPEN_SECTION_ORDER.flatMap((source) => {
      const bucket = buckets[source];
      if (bucket.length === 0) return [];
      return [sectionLabel(source, t(QUICK_OPEN_SECTION_LABEL_KEY[source])), ...bucket.map(({ row, index }) => render(row, index))];
    }),
  ];
}
