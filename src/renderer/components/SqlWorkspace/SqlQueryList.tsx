/**
 * RL-097 Slice 2 — Left column of the SQL workspace: list of saved
 * queries + create / activate / rename / delete affordances.
 *
 * Mirror of `<HttpRequestList>` from Slice 1 — same row shape, same
 * keyboard a11y, same native-confirm pattern on delete. The only
 * difference is that the left chip shows the first non-whitespace
 * word of the query as a hint instead of an HTTP method (so a
 * `SELECT ...` row reads `SELECT`).
 */

import { Plus, Trash2 } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
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
}

/**
 * Extract the first non-whitespace word from the query for the
 * left-side chip. Caps at 8 chars so a long identifier doesn't
 * overflow the row. Falls back to `'SQL'` for an empty query.
 */
function queryChipLabel(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) return 'SQL';
  const firstWord = trimmed.split(/\s+/, 1)[0] ?? 'SQL';
  return firstWord.slice(0, 8).toUpperCase();
}

export function SqlQueryList({
  queries,
  activeQueryId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SqlQueryListProps) {
  const { t } = useTranslation();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const handleDeleteClick = useCallback(
    (id: string) => {
      const ok = window.confirm(t('sqlWorkspace.queryList.deleteConfirm'));
      if (!ok) return;
      onDelete(id);
    },
    [t, onDelete]
  );

  return (
    <div
      data-testid="sql-query-list"
      className="flex h-full flex-col overflow-hidden border-r border-border/60"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/40 px-2 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          {t('sqlWorkspace.queryList.label')}
        </span>
        <button
          type="button"
          onClick={onCreate}
          aria-label={t('sqlWorkspace.queryList.newQuery')}
          title={t('sqlWorkspace.queryList.newQuery')}
          data-testid="sql-query-list-create"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </header>
      <ul
        role="list"
        className="flex-1 overflow-y-auto"
        aria-label={t('sqlWorkspace.queryList.ariaLabel')}
      >
        {queries.length === 0 ? (
          <li className="px-3 py-4 text-xs text-muted">
            {t('sqlWorkspace.queryList.empty')}
          </li>
        ) : null}
        {queries.map((q) => {
          const isActive = q.id === activeQueryId;
          const isRenaming = renamingId === q.id;
          return (
            <li
              key={q.id}
              data-testid="sql-query-list-row"
              data-query-id={q.id}
              data-active={isActive}
              role="button"
              tabIndex={isRenaming ? -1 : 0}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'group flex min-h-[28px] items-center gap-2 border-b border-border/30 px-2 py-1 text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                isActive
                  ? 'bg-background-elevated text-foreground'
                  : 'text-muted hover:bg-surface-strong/60 hover:text-foreground'
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
                className="shrink-0 rounded bg-surface-strong/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-muted"
              >
                {queryChipLabel(q.query)}
              </span>
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  defaultValue={q.name}
                  data-testid="sql-query-list-rename-input"
                  className="min-w-0 flex-1 truncate bg-transparent text-xs outline-none focus:ring-0"
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next.length > 0 && next !== q.name) {
                      onRename(q.id, next);
                    }
                    setRenamingId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                />
              ) : (
                <span
                  className="min-w-0 flex-1 truncate"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setRenamingId(q.id);
                  }}
                >
                  {q.name.length > 0
                    ? q.name
                    : t('sqlWorkspace.queryList.renamePlaceholder')}
                </span>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteClick(q.id);
                }}
                aria-label={t('sqlWorkspace.queryList.deleteAria', {
                  name: q.name,
                })}
                data-testid="sql-query-list-delete"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-rose-500 group-hover:opacity-100"
              >
                <Trash2 size={11} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
