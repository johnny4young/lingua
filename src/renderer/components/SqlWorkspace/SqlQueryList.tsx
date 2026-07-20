/**
 * implementation — Left column of the SQL workspace: list of saved
 * queries + create / activate / rename / delete affordances.
 *
 * Mirror of `<HttpRequestList>` from implementation — same row shape, same
 * keyboard a11y, same native-confirm pattern on delete. The only
 * difference is that the left chip shows the first non-whitespace
 * word of the query as a hint instead of an HTTP method (so a
 * `SELECT ...` row reads `SELECT`).
 */

import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
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
  /** Clone the query under a fresh id + select it. */
  onDuplicate: (id: string) => void;
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
  onDuplicate,
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
      className="flex h-full flex-col overflow-hidden bg-bg-panel"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-2.5 py-2">
        <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
          {t('sqlWorkspace.queryList.label')}
        </span>
        <button
          type="button"
          onClick={onCreate}
          aria-label={t('sqlWorkspace.queryList.newQuery')}
          title={t('sqlWorkspace.queryList.newQuery')}
          data-testid="sql-query-list-create"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-subtle bg-bg-panel-alt text-fg-subtle transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </header>
      <ul
        role="list"
        className="flex-1 overflow-y-auto p-1.5"
        aria-label={t('sqlWorkspace.queryList.ariaLabel')}
      >
        {queries.length === 0 ? (
          <li className="px-2.5 py-4 text-body-sm text-fg-subtle">
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
                'group mb-0.5 flex min-h-[32px] cursor-pointer items-center gap-2 rounded-md border-l-2 px-2.5 py-1.5 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                isActive
                  ? 'border-l-accent bg-bg-inset text-fg-base'
                  : 'border-l-transparent text-fg-muted hover:bg-bg-panel-alt hover:text-fg-base'
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
                  data-testid="sql-query-list-rename-input"
                  className="min-w-0 flex-1 truncate bg-transparent text-body-sm text-fg-base outline-none focus:ring-0"
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
              {isRenaming ? null : (
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setRenamingId(q.id);
                    }}
                    aria-label={t('sqlWorkspace.queryList.renameAria', {
                      name: q.name,
                    })}
                    title={t('sqlWorkspace.queryList.rename')}
                    data-testid="sql-query-list-rename"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <Pencil size={11} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDuplicate(q.id);
                    }}
                    aria-label={t('sqlWorkspace.queryList.duplicateAria', {
                      name: q.name,
                    })}
                    title={t('sqlWorkspace.queryList.duplicate')}
                    data-testid="sql-query-list-duplicate"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <Copy size={11} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteClick(q.id);
                    }}
                    aria-label={t('sqlWorkspace.queryList.deleteAria', {
                      name: q.name,
                    })}
                    title={t('sqlWorkspace.queryList.delete')}
                    data-testid="sql-query-list-delete"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
