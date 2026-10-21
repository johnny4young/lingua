import { Loader2, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SqlQueryV1 } from '../../../shared/sqlWorkspace';
import { cn } from '../../utils/cn';

/** Query tabs inside the SQL tab. Each one counts toward the Free tab budget. */
export function SqlQueryTabs({
  tabs,
  activeId,
  runningId,
  onSelect,
  onClose,
  onCreate,
  freeHint,
}: {
  tabs: ReadonlyArray<SqlQueryV1>;
  activeId: string | null;
  runningId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
  /** Shown on Free, where these tabs share the open-tab budget. */
  freeHint: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="sql-query-tabs"
      className="flex h-[30px] shrink-0 items-stretch border-b border-border-subtle bg-bg-panel"
    >
      <div role="tablist" aria-label={t('sqlWorkspace.tabs.label')} className="flex min-w-0 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const unsaved = tab.kind === 'scratch' && tab.query.trim().length > 0;
          const name = tab.name.length > 0 ? tab.name : t('sqlWorkspace.queryList.renamePlaceholder');
          return (
            <div
              key={tab.id}
              data-testid="sql-query-tab"
              data-query-id={tab.id}
              data-active={active}
              className={cn(
                'group flex max-w-[200px] shrink-0 items-center gap-1 border-r border-border-subtle pl-2.5 pr-1 text-caption',
                active ? 'bg-bg-base text-fg-base shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-fg-muted hover:bg-bg-panel-alt'
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(tab.id)}
                title={name}
                className="flex min-w-0 items-center gap-1.5 self-stretch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
              >
                {tab.id === runningId ? (
                  <Loader2 size={10} aria-hidden="true" className="shrink-0 animate-spin text-accent" />
                ) : null}
                <span className={cn('min-w-0 truncate', tab.kind === 'scratch' && 'italic')}>{name}</span>
                {unsaved ? (
                  <span
                    data-testid="sql-query-tab-unsaved"
                    aria-label={t('sqlWorkspace.tabs.unsaved')}
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-fg"
                  />
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onClose(tab.id)}
                aria-label={t('sqlWorkspace.tabs.close', { name })}
                title={t('sqlWorkspace.tabs.close', { name })}
                data-testid="sql-query-tab-close"
                className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-fg-subtle opacity-60 transition-opacity hover:bg-bg-panel-alt hover:text-fg-base hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 group-hover:opacity-100"
              >
                <X size={10} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onCreate}
        aria-label={t('sqlWorkspace.queryList.newQuery')}
        title={t('sqlWorkspace.queryList.newQuery')}
        data-testid="sql-query-tabs-create"
        className="inline-flex w-[30px] shrink-0 items-center justify-center text-fg-subtle hover:bg-bg-panel-alt hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        <Plus size={12} aria-hidden="true" />
      </button>
      {freeHint !== null ? (
        <span
          data-testid="sql-query-tabs-free-hint"
          title={freeHint}
          className="ml-auto hidden min-w-0 shrink items-center truncate px-2.5 font-mono text-micro text-fg-subtle md:flex"
        >
          {freeHint}
        </span>
      ) : null}
    </div>
  );
}
