/**
 * RL-097 Slice 1 — Left column of the HTTP workspace: list of saved
 * requests + create / activate / rename / delete affordances.
 *
 * Each row renders the method + name. Click activates the request;
 * double-click on the name starts an inline rename. Trash icon
 * opens a native confirm before deleting (RL-024 Slice 2 pattern —
 * native confirm matches the "no silent mutation" principle).
 */

import { Plus, Trash2 } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { HttpRequestV1 } from '../../../shared/httpWorkspace';
import { cn } from '../../utils/cn';

export interface HttpRequestListProps {
  requests: ReadonlyArray<HttpRequestV1>;
  activeRequestId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function HttpRequestList({
  requests,
  activeRequestId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: HttpRequestListProps) {
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
      const ok = window.confirm(t('httpWorkspace.requestList.delete.confirm'));
      if (!ok) return;
      onDelete(id);
    },
    [t, onDelete]
  );

  return (
    <div
      data-testid="http-request-list"
      className="flex h-full flex-col overflow-hidden border-r border-border/60"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/40 px-2 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          {t('httpWorkspace.requestList.label')}
        </span>
        <button
          type="button"
          onClick={onCreate}
          aria-label={t('httpWorkspace.requestList.create')}
          title={t('httpWorkspace.requestList.create')}
          data-testid="http-request-list-create"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </header>
      <ul
        role="list"
        className="flex-1 overflow-y-auto"
        aria-label={t('httpWorkspace.requestList.ariaLabel')}
      >
        {requests.length === 0 ? (
          <li className="px-3 py-4 text-xs text-muted">
            {t('httpWorkspace.requestList.empty')}
          </li>
        ) : null}
        {requests.map((req) => {
          const isActive = req.id === activeRequestId;
          const isRenaming = renamingId === req.id;
          return (
            <li
              key={req.id}
              data-testid="http-request-list-row"
              data-request-id={req.id}
              data-active={isActive}
              // Fixed-height row keeps the chrome stable regardless
              // of method width or localized placeholder length.
              // Reviewer pass — a11y: role="button" + tabIndex +
              // onKeyDown make the row keyboard-activatable. The
              // trash sub-button has its own focus handler. While
              // renaming, the row's tabIndex drops to -1 so the
              // input keeps focus.
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
                if (!isRenaming) onSelect(req.id);
              }}
              onKeyDown={(event) => {
                if (isRenaming) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(req.id);
                }
              }}
            >
              <span
                data-testid="http-request-list-row-method"
                className="shrink-0 rounded bg-surface-strong/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-muted"
              >
                {req.method}
              </span>
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  defaultValue={req.name}
                  data-testid="http-request-list-rename-input"
                  className="min-w-0 flex-1 truncate bg-transparent text-xs outline-none focus:ring-0"
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next.length > 0 && next !== req.name) {
                      onRename(req.id, next);
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
                    setRenamingId(req.id);
                  }}
                >
                  {req.name.length > 0
                    ? req.name
                    : t('httpWorkspace.requestList.rename.placeholder')}
                </span>
              )}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteClick(req.id);
                }}
                aria-label={t('httpWorkspace.requestList.delete.aria', {
                  name: req.name,
                })}
                data-testid="http-request-list-delete"
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
