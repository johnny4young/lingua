/**
 * Query sections of the SQL Explorer: Scratches (unsaved, discarded with
 * their tab) and Saved queries grouped by folder. Rows open the query as
 * a tab; saved rows can be renamed, duplicated and deleted.
 */

import { ChevronDown, ChevronRight, Copy, Folder, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlQueryV1 } from '../../../shared/sqlWorkspace';
import { cn } from '../../utils/cn';

export interface SqlQueryListProps {
  queries: ReadonlyArray<SqlQueryV1>;
  activeQueryId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Clone the query under a fresh id + select it. */
  onDuplicate: (id: string) => void;
  /** The Explorer filter: narrows the list by name or SQL text. */
  filter?: string;
  /** Where a saved query runs, shown on its row; unset while connections are off. */
  connectionLabel?: (connectionId: string | undefined) => string;
}

/** First word of the query, capped at 8 characters, for the row chip. */
function queryChipLabel(query: string): string {
  const firstWord = query.trim().split(/\s+/, 1)[0] ?? '';
  return firstWord.length === 0 ? 'SQL' : firstWord.slice(0, 8).toUpperCase();
}

const ROW_ACTION =
  'inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

const SECTION_LABEL = 'font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle';

export function SqlQueryList({
  queries,
  activeQueryId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDuplicate,
  filter = '',
  connectionLabel,
}: SqlQueryListProps) {
  const { t } = useTranslation();
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle.length === 0
        ? queries
        : queries.filter((q) => q.name.toLowerCase().includes(needle) || q.query.toLowerCase().includes(needle)),
    [queries, needle]
  );
  const scratches = visible.filter((q) => q.kind === 'scratch');
  const saved = visible.filter((q) => q.kind !== 'scratch');
  const savedCount = queries.filter((q) => q.kind !== 'scratch').length;
  const folders = useMemo(() => {
    const byFolder = new Map<string, SqlQueryV1[]>();
    for (const q of saved) {
      if (q.folder === undefined) continue;
      byFolder.set(q.folder, [...(byFolder.get(q.folder) ?? []), q]);
    }
    return [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [saved]);
  const unfiled = saved.filter((q) => q.folder === undefined);
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const handleDeleteClick = useCallback(
    (q: SqlQueryV1) => {
      const key = q.kind === 'scratch' ? 'sqlWorkspace.queryList.discardConfirm' : 'sqlWorkspace.queryList.deleteConfirm';
      if (window.confirm(t(key))) onDelete(q.id);
    },
    [t, onDelete]
  );

  const row = (q: SqlQueryV1, depth: number) => {
    const isActive = q.id === activeQueryId;
    const isRenaming = renamingId === q.id;
    const isScratch = q.kind === 'scratch';
    const label = q.name.length > 0 ? q.name : t('sqlWorkspace.queryList.renamePlaceholder');
    return (
      <li
        key={q.id}
        data-testid="sql-query-list-row"
        data-query-id={q.id}
        data-active={isActive}
        data-section={isScratch ? 'scratch' : 'saved'}
        role="button"
        tabIndex={isRenaming ? -1 : 0}
        aria-current={isActive ? 'true' : undefined}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        className={cn(
          'group flex min-h-[23px] cursor-pointer items-center gap-2 rounded-md py-0.5 pr-2.5 text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          isActive
            ? 'bg-bg-inset font-medium text-fg-base'
            : 'text-fg-muted hover:bg-bg-panel-alt hover:text-fg-base'
        )}
        onClick={() => {
          if (!isRenaming) onSelect(q.id);
        }}
        onKeyDown={(event) => {
          if (isRenaming) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(q.id);
          }
        }}
      >
        <span
          data-testid="sql-query-list-row-chip"
          className="shrink-0 font-mono text-nano font-bold tracking-[0.04em] text-accent"
        >
          {queryChipLabel(q.query)}
        </span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            defaultValue={q.name}
            aria-label={t('sqlWorkspace.queryList.renameAria', { name: q.name })}
            data-testid="sql-query-list-rename-input"
            className="min-w-0 flex-1 truncate bg-transparent text-body-sm text-fg-base outline-none focus:ring-0"
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next.length > 0 && next !== q.name) onRename(q.id, next);
              setRenamingId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              else if (event.key === 'Escape') setRenamingId(null);
            }}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate"
            onDoubleClick={(event) => {
              if (isScratch) return;
              event.stopPropagation();
              setRenamingId(q.id);
            }}
          >
            {label}
          </span>
        )}
        {connectionLabel && !isScratch && !isRenaming ? (
          <span data-testid="sql-query-list-connection" className="max-w-[45%] shrink-0 truncate font-mono text-micro text-fg-subtle">
            {connectionLabel(q.connectionId)}
          </span>
        ) : null}
        {isRenaming ? null : (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {isScratch ? null : (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRenamingId(q.id);
                  }}
                  aria-label={t('sqlWorkspace.queryList.renameAria', { name: label })}
                  title={t('sqlWorkspace.queryList.rename')}
                  data-testid="sql-query-list-rename"
                  className={ROW_ACTION}
                >
                  <Pencil size={11} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDuplicate(q.id);
                  }}
                  aria-label={t('sqlWorkspace.queryList.duplicateAria', { name: label })}
                  title={t('sqlWorkspace.queryList.duplicate')}
                  data-testid="sql-query-list-duplicate"
                  className={ROW_ACTION}
                >
                  <Copy size={11} aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleDeleteClick(q);
              }}
              aria-label={t(isScratch ? 'sqlWorkspace.queryList.discardAria' : 'sqlWorkspace.queryList.deleteAria', {
                name: label,
              })}
              title={t(isScratch ? 'sqlWorkspace.queryList.discard' : 'sqlWorkspace.queryList.delete')}
              data-testid="sql-query-list-delete"
              className={cn(ROW_ACTION, 'hover:text-error-fg')}
            >
              <Trash2 size={11} aria-hidden="true" />
            </button>
          </span>
        )}
      </li>
    );
  };

  const toggleFolder = (folder: string) =>
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  return (
    <div data-testid="sql-query-list" className="flex flex-col border-t border-border-subtle bg-bg-panel">
      <header className="flex h-[26px] items-center gap-2 pl-2.5 pr-1.5">
        <span className={SECTION_LABEL}>{t('sqlWorkspace.queryList.scratches')}</span>
        <span data-testid="sql-scratch-count" className="font-mono text-micro tabular-nums text-fg-subtle">
          {queries.length - savedCount}
        </span>
        <button
          type="button"
          onClick={onCreate}
          aria-label={t('sqlWorkspace.queryList.newQuery')}
          title={t('sqlWorkspace.queryList.newQuery')}
          data-testid="sql-query-list-create"
          className="ml-auto inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-panel-alt hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Plus size={11} aria-hidden="true" />
        </button>
      </header>
      <ul role="list" className="px-1.5 pb-1.5" aria-label={t('sqlWorkspace.queryList.scratches')}>
        {scratches.length === 0 ? (
          <li className="px-2.5 py-1 text-caption text-fg-subtle">{t('sqlWorkspace.queryList.noScratches')}</li>
        ) : (
          scratches.map((q) => row(q, 0))
        )}
      </ul>

      <header className="flex h-[26px] items-center gap-2 border-t border-border-subtle pl-2.5 pr-1.5">
        <span className={SECTION_LABEL}>{t('sqlWorkspace.queryList.label')}</span>
        <span data-testid="sql-query-list-count" className="font-mono text-micro tabular-nums text-fg-subtle">
          {savedCount}
        </span>
      </header>
      <ul role="list" className="px-1.5 pb-1.5" aria-label={t('sqlWorkspace.queryList.ariaLabel')}>
        {saved.length === 0 ? (
          <li className="px-2.5 py-1 text-caption text-fg-subtle">
            {t(savedCount === 0 ? 'sqlWorkspace.queryList.empty' : 'sqlWorkspace.queryList.noMatch')}
          </li>
        ) : null}
        {unfiled.map((q) => row(q, 0))}
        {folders.map(([folder, items]) => {
          const open = needle.length > 0 || !collapsedFolders.has(folder);
          return (
            <li key={`folder:${folder}`}>
              <button
                type="button"
                onClick={() => toggleFolder(folder)}
                aria-expanded={open}
                data-testid="sql-query-folder"
                data-folder={folder}
                className="flex h-[23px] w-full items-center gap-1.5 rounded-md px-2.5 text-left text-caption text-fg-muted hover:bg-bg-panel-alt hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {open ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
                <Folder size={11} aria-hidden="true" className="shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate">{folder}</span>
                <span className="font-mono text-micro tabular-nums text-fg-subtle">{items.length}</span>
              </button>
              {open ? <ul role="list">{items.map((q) => row(q, 1))}</ul> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
