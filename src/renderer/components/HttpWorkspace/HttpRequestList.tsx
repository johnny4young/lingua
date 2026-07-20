/**
 * implementation — Left column of the HTTP workspace: list of saved
 * requests + create / activate / rename / delete affordances.
 *
 * Each row renders the method + name. Click activates the request;
 * double-click on the name starts an inline rename. Trash icon
 * opens a native confirm before deleting (implementation pattern —
 * native confirm matches the "no silent mutation" principle).
 */

import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
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
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function HttpRequestList({
  requests,
  activeRequestId,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
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
      className="flex h-full flex-col overflow-hidden border-r border-border-subtle bg-bg-panel"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2.5">
        <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
          {t('httpWorkspace.requestList.label')}
        </span>
        <button
          type="button"
          onClick={onCreate}
          aria-label={t('httpWorkspace.requestList.create')}
          title={t('httpWorkspace.requestList.create')}
          data-testid="http-request-list-create"
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border border-border-subtle text-fg-subtle transition-colors hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </header>
      <ul
        role="list"
        className="flex-1 overflow-y-auto p-1.5"
        aria-label={t('httpWorkspace.requestList.ariaLabel')}
      >
        {requests.length === 0 ? (
          <li className="px-2 py-3 text-body-sm text-fg-subtle">
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
              // FASE 3 — proto rail row: rounded inset surface + 2px
              // accent left-border when active (httpWs `Rail`,
              // `borderLeft: 2px solid D.acc`). The left-border slot is
              // always reserved (transparent when inactive) so the row
              // text never shifts on selection.
              className={cn(
                'group mb-0.5 flex min-h-[32px] cursor-pointer items-center gap-2 rounded-md border-l-2 px-2.5 py-1.5 text-body-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                isActive
                  ? 'border-l-accent bg-bg-inset text-fg-base'
                  : 'border-l-transparent text-fg-muted hover:bg-bg-inset/60 hover:text-fg-base'
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
                className="shrink-0 font-mono text-micro font-bold uppercase tracking-[0.04em] text-fg-subtle"
              >
                {req.method}
              </span>
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  defaultValue={req.name}
                  data-testid="http-request-list-rename-input"
                  className="min-w-0 flex-1 truncate bg-transparent text-body-sm outline-none focus:ring-0"
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
              {/* Row actions: rename / duplicate / delete. Hidden until
                  hover or keyboard focus to keep the rail uncluttered;
                  always reachable via Tab (focus-visible reveals them). */}
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRenamingId(req.id);
                  }}
                  aria-label={t('httpWorkspace.requestList.rename.aria', {
                    name: req.name,
                  })}
                  title={t('httpWorkspace.requestList.rename.title')}
                  data-testid="http-request-list-rename"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Pencil size={11} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDuplicate(req.id);
                  }}
                  aria-label={t('httpWorkspace.requestList.duplicate.aria', {
                    name: req.name,
                  })}
                  title={t('httpWorkspace.requestList.duplicate.title')}
                  data-testid="http-request-list-duplicate"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Copy size={11} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDeleteClick(req.id);
                  }}
                  aria-label={t('httpWorkspace.requestList.delete.aria', {
                    name: req.name,
                  })}
                  title={t('httpWorkspace.requestList.delete.title')}
                  data-testid="http-request-list-delete"
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:text-error-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
