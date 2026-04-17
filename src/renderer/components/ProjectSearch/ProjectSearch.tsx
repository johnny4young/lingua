import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import {
  useProjectSearchStore,
  type ProjectSearchMatch,
  type ProjectSearchResult,
} from '../../stores/projectSearchStore';
import { useProjectStore } from '../../stores/projectStore';
import { PLAINTEXT_LANGUAGE, languageFromPath } from '../../utils/language';
import { Kbd, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { handleCloseOnEscape } from '../ui/keyboard';

const SEARCH_DEBOUNCE_MS = 220;

interface ProjectSearchProps {
  onClose: () => void;
}

interface FlatRow {
  kind: 'file' | 'match';
  key: string;
  result: ProjectSearchResult;
  match?: ProjectSearchMatch;
}

/**
 * Flatten grouped-by-file results into a single navigable list. File headers
 * are still rendered but only match rows are selectable so arrow-key navigation
 * feels natural.
 */
function buildFlatRows(results: ProjectSearchResult[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const result of results) {
    rows.push({ kind: 'file', key: `file:${result.filePath}`, result });
    for (const match of result.matches) {
      rows.push({
        kind: 'match',
        key: `match:${result.filePath}:${match.line}:${match.column}`,
        result,
        match,
      });
    }
  }
  return rows;
}

function MatchPreview({ match }: { match: ProjectSearchMatch }) {
  const before = match.preview.slice(0, match.matchStart);
  const hit = match.preview.slice(match.matchStart, match.matchEnd);
  const after = match.preview.slice(match.matchEnd);

  return (
    <span className="block truncate font-mono text-xs leading-6 text-muted">
      {before}
      <mark className="rounded-sm bg-primary/30 px-0.5 text-foreground">{hit}</mark>
      {after}
    </span>
  );
}

export function ProjectSearch({ onClose }: ProjectSearchProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);

  const openFile = useEditorStore((state) => state.openFile);
  const requestReveal = useEditorStore((state) => state.requestReveal);
  const clearPendingReveal = useEditorStore((state) => state.clearPendingReveal);
  const currentProject = useProjectStore((state) => state.currentProject);

  const query = useProjectSearchStore((state) => state.query);
  const setQuery = useProjectSearchStore((state) => state.setQuery);
  const search = useProjectSearchStore((state) => state.search);
  const clear = useProjectSearchStore((state) => state.clear);
  const status = useProjectSearchStore((state) => state.status);
  const results = useProjectSearchStore((state) => state.results);
  const totalMatches = useProjectSearchStore((state) => state.totalMatches);
  const error = useProjectSearchStore((state) => state.error);

  // Debounce query → search. Disabled when no project is active.
  useEffect(() => {
    if (!currentProject) return;
    const rootPath = currentProject.rootPath;
    const timeout = window.setTimeout(() => {
      void search(rootPath, query);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [query, currentProject, search]);

  // Focus the input on mount.
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      clear();
    };
  }, [clear]);

  const rows = useMemo(() => buildFlatRows(results), [results]);
  const matchRows = useMemo(() => rows.filter((row) => row.kind === 'match'), [rows]);

  // Default selection: first match. Clear when results drop to zero.
  useEffect(() => {
    if (matchRows.length === 0) {
      setSelectedMatchKey(null);
      return;
    }
    setSelectedMatchKey((current) => {
      if (current && matchRows.some((row) => row.key === current)) {
        return current;
      }
      return matchRows[0]?.key ?? null;
    });
  }, [matchRows]);

  // Scroll the selected row into view so arrow navigation on long result lists
  // does not run off the visible area. We iterate children manually instead of
  // using a CSS attribute selector so the lookup stays safe regardless of
  // exotic characters in file paths and avoids relying on `CSS.escape` (which
  // is not part of the jsdom surface used in tests).
  useEffect(() => {
    if (!selectedMatchKey) return;
    const list = listRef.current;
    if (!list) return;
    for (const child of Array.from(list.children) as HTMLElement[]) {
      if (child.dataset.rowKey === selectedMatchKey) {
        child.scrollIntoView({ block: 'nearest' });
        break;
      }
    }
  }, [selectedMatchKey]);

  const openMatch = async (row: FlatRow) => {
    if (!row.match) return;
    const language = languageFromPath(row.result.filePath) ?? PLAINTEXT_LANGUAGE;
    const name = row.result.filePath.split(/[\\/]/).pop() ?? row.result.filePath;
    // Queue the reveal BEFORE opening so CodeEditor's effect catches it
    // whether the target file is already open (openFile just activates the
    // existing tab) or a fresh tab is being created. openFile is idempotent,
    // so this ordering is safe for both paths.
    requestReveal({
      filePath: row.result.filePath,
      line: row.match.line,
      column: row.match.column,
    });
    try {
      await openFile(row.result.filePath, name, language);
    } catch {
      clearPendingReveal();
      return;
    }
    onClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (matchRows.length === 0) return;
      event.preventDefault();
      const currentIndex = Math.max(
        0,
        matchRows.findIndex((row) => row.key === selectedMatchKey)
      );
      const nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(currentIndex + 1, matchRows.length - 1)
          : Math.max(currentIndex - 1, 0);
      setSelectedMatchKey(matchRows[nextIndex]?.key ?? null);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const target = matchRows.find((row) => row.key === selectedMatchKey);
      if (target) void openMatch(target);
      return;
    }

    handleCloseOnEscape(event, onClose);
  };

  const hasQuery = query.trim().length > 0;
  const showEmptyState = status === 'ready' && results.length === 0 && hasQuery;
  const showNoProject = !currentProject;

  return (
    <OverlayBackdrop align="top" onClose={onClose}>
      <OverlayCard className="w-full max-w-3xl">
        <div className="surface-header flex items-center gap-3 px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('projectSearch.placeholder')}
            aria-label={t('projectSearch.placeholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="icon-button"
              aria-label={t('projectSearch.clear')}
            >
              <X size={12} />
            </button>
          )}
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[28rem] overflow-y-auto px-2 py-2">
          {showNoProject ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {t('projectSearch.empty.noProject')}
            </p>
          ) : status === 'error' ? (
            <p className="px-4 py-10 text-center text-sm text-danger">
              {t('projectSearch.error', { message: error ?? '' })}
            </p>
          ) : showEmptyState ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {t('projectSearch.empty.noMatch', { query })}
            </p>
          ) : !hasQuery ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {t('projectSearch.empty.hint')}
            </p>
          ) : (
            rows.map((row) => {
              if (row.kind === 'file') {
                return (
                  <div
                    key={row.key}
                    data-row-key={row.key}
                    className="mt-3 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted"
                  >
                    {row.result.relativePath || row.result.filePath}
                  </div>
                );
              }

              const isSelected = row.key === selectedMatchKey;
              return (
                <button
                  key={row.key}
                  type="button"
                  data-row-key={row.key}
                  onClick={() => void openMatch(row)}
                  onMouseEnter={() => setSelectedMatchKey(row.key)}
                  className={`flex w-full items-start gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${
                    isSelected ? 'bg-primary-soft' : 'hover:bg-surface-strong/68'
                  }`}
                >
                  <span className="mt-[0.2rem] w-12 shrink-0 text-right font-mono text-xs text-muted">
                    {row.match?.line}:{row.match?.column}
                  </span>
                  {row.match && <MatchPreview match={row.match} />}
                </button>
              );
            })
          )}
        </div>

        <div className="surface-header flex items-center gap-4 px-4 py-3 text-[11px] text-muted">
          <span>
            <Kbd>↑↓</Kbd> {t('projectSearch.hint.navigate')}
          </span>
          <span>
            <Kbd>↵</Kbd> {t('projectSearch.hint.open')}
          </span>
          <span className="ml-auto">
            {status === 'loading'
              ? t('projectSearch.loading')
              : t('projectSearch.count', {
                  count: totalMatches,
                  files: results.length,
                })}
          </span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
