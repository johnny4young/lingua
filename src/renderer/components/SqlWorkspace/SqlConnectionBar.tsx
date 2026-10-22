import { Check, ChevronDown, Lock, MoreHorizontal, Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlDbCatalogView, SqlDbConnectionView } from '../../../shared/sqlDb';
import { cn } from '../../utils/cn';
import { ChipContent as Chip, ConnectionChip } from './SqlConnectionChip';
import { CONNECTION_TONE, ENGINE_LABEL, engineDetail as detailOf, toneOf, type SqlConnectionTone } from './sqlConnectionStyle';
import '../../i18n/sqlConnectionsCatalog';

/** Saved connections in the picker; absent while the Database connections flag is off. */
export interface SqlConnectionPickerRemote {
  /** False on the web build: the picker says why only Local is listed. */
  desktop: boolean;
  catalog: SqlDbCatalogView | null;
  /** The active query's connection; undefined is Local. */
  activeId: string | undefined;
  onSelect: (connectionId: string | undefined) => void;
  onNew: () => void;
  onOpenUrl: () => void;
  onEdit: (connectionId: string) => void;
  onManage: () => void;
}

interface SqlConnectionBarProps {
  /** Right-aligned actions (Import data). */
  actions?: ReactNode;
  remote?: SqlConnectionPickerRemote;
}

const LOCAL_ENGINE = 'DuckDB';


/**
 * Connection toolbar of the SQL tab. Local (DuckDB) is first and the default;
 * with the Database connections flag on, saved connections follow it, with
 * their environment colour, and the picker opens the new-connection sheet.
 */
export function SqlConnectionBar({ actions, remote }: SqlConnectionBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();
  const close = () => {
    setOpen(false);
    pillRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      pillRef.current?.focus();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const localName = t('sqlWorkspace.connection.localName');
  const readOnly = t('sqlWorkspace.connection.readOnlyShort');
  const needle = search.trim().toLowerCase();
  const matches = (text: string) => needle.length === 0 || text.toLowerCase().includes(needle);
  const localMatches = matches(`${localName} ${LOCAL_ENGINE}`);
  const desktop = remote?.desktop === true;
  const catalog = desktop ? remote?.catalog : null;
  const all = catalog ? [...catalog.connections, ...catalog.adhoc] : [];
  const active = remote?.activeId ? all.find((entry) => entry.id === remote.activeId) : undefined;
  const missing = Boolean(remote?.activeId) && desktop && catalog !== null && !active;
  const saved = (catalog?.connections ?? []).filter((entry) => matches(`${entry.name} ${ENGINE_LABEL[entry.engine]} ${entry.group ?? ''}`));
  const adhoc = (catalog?.adhoc ?? []).filter((entry) => matches(`${entry.name} ${ENGINE_LABEL[entry.engine]}`));

  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const index = options.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
    options[next]?.focus();
  };

  const choose = (id: string | undefined) => {
    remote?.onSelect(id);
    close();
  };

  const optionProps = (id: string | undefined) => ({
    role: 'option' as const,
    tabIndex: -1,
    'aria-selected': (remote?.activeId ?? undefined) === id,
    onClick: () => choose(id),
    onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(id);
      } else moveFocus(event);
    },
  });

  const row = (connection: SqlDbConnectionView) => (
    <li
      key={connection.id}
      {...optionProps(connection.id)}
      data-testid="sql-connection-option"
      data-connection-id={connection.id}
      className={cn(
        'focus-ring group flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-bg-panel-alt',
        connection.id === remote?.activeId && 'bg-accent-tint'
      )}
    >
      <ConnectionChip connection={connection} readOnlyLabel={readOnly} />
      <span className="ml-auto truncate font-mono text-caption text-fg-subtle">{connection.group ?? ''}</span>
      <button
        type="button"
        tabIndex={-1}
        data-testid="sql-connection-edit"
        aria-label={t('sqlWorkspace.connection.edit', { name: connection.name })}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(false);
          remote?.onEdit(connection.id);
        }}
        className="focus-ring rounded p-0.5 text-fg-subtle opacity-0 hover:text-fg-base group-hover:opacity-100 group-focus:opacity-100"
      >
        <MoreHorizontal size={13} aria-hidden="true" />
      </button>
    </li>
  );

  const pillTone: SqlConnectionTone = active ? toneOf(active.env) : missing ? 'staging' : 'local';
  const pillName = active ? active.name : missing ? t('sqlWorkspace.connection.missingName') : localName;
  const pillDetail = active ? detailOf(active, readOnly) : missing ? '' : LOCAL_ENGINE;

  return (
    <div
      data-testid="sql-connection-bar"
      className="flex h-[38px] shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-base px-2.5"
    >
      <div ref={rootRef} className="relative">
        <button
          ref={pillRef}
          type="button"
          data-testid="sql-connection-pill"
          data-env={active?.env ?? (active ? 'none' : 'local')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={t('sqlWorkspace.connection.pillAria', { name: `${pillName} ${pillDetail}`.trim() })}
          onClick={() => {
            setSearch('');
            setOpen((value) => !value);
          }}
          className={cn('focus-ring inline-flex h-[26px] items-center gap-[7px] rounded-[7px] border px-[9px]', CONNECTION_TONE[pillTone].chip)}
        >
          <Chip tone={pillTone} name={pillName} detail={pillDetail} />
          <ChevronDown size={11} aria-hidden="true" className="text-fg-muted" />
        </button>
        {open ? (
          <div
            data-testid="sql-connection-picker"
            className="absolute left-0 top-[calc(100%+0.375rem)] z-50 w-[400px] max-w-[calc(100vw-2rem)] rounded-[10px] border border-border-default bg-bg-panel p-1.5 shadow-e3"
          >
            <input
              type="search"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  listRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
                }
              }}
              placeholder={t('sqlWorkspace.connection.find')}
              aria-label={t('sqlWorkspace.connection.find')}
              data-testid="sql-connection-search"
              className="h-[26px] w-full rounded-md border border-border-default bg-bg-inset px-2 text-body-sm text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            />
            <ul ref={listRef} id={listId} role="listbox" aria-label={t('sqlWorkspace.connection.listAria')}>
              <li role="presentation" className="px-2 pb-[3px] pt-[7px] font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                {t('sqlWorkspace.connection.thisDevice')}
              </li>
              {localMatches ? (
                <li
                  {...optionProps(undefined)}
                  data-testid="sql-connection-option-local"
                  className={cn('focus-ring flex h-8 cursor-pointer items-center gap-[7px] rounded-md px-2', !active && 'bg-accent-tint')}
                >
                  <Chip tone="local" name={localName} detail={LOCAL_ENGINE} />
                  <span className="ml-auto font-mono text-caption text-fg-muted">{t('sqlWorkspace.connection.localDefault')}</span>
                  {!active ? <Check size={12} aria-hidden="true" className="text-accent-fg" /> : null}
                </li>
              ) : null}
              {remote && !desktop ? (
                <li role="presentation" data-testid="sql-connection-desktop-only" className="px-2 py-1.5">
                  <span className="flex items-center gap-2 text-body-sm text-fg-subtle">
                    <Lock size={12} aria-hidden="true" />
                    {t('sqlWorkspace.connection.desktopEngines')}
                    <span className="ml-auto rounded border border-border-default px-1.5 font-mono text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">
                      {t('sqlWorkspace.connection.desktopOnly')}
                    </span>
                  </span>
                  <span className="mt-1 block text-caption leading-relaxed text-fg-muted">{t('sqlWorkspace.connection.desktopOnlyReason')}</span>
                </li>
              ) : null}
              {catalog ? (
                <>
                  <li role="presentation" data-testid="sql-connection-saved-count" className="px-2 pb-[3px] pt-[9px] font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                    {catalog.limit === null
                      ? t('sqlWorkspace.connection.savedUnlimited', { count: catalog.used })
                      : t('sqlWorkspace.connection.savedOfLimit', { used: catalog.used, limit: catalog.limit })}
                  </li>
                  {saved.map(row)}
                  {adhoc.length > 0 ? (
                    <li role="presentation" className="px-2 pb-[3px] pt-[9px] font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                      {t('sqlWorkspace.connection.session')}
                    </li>
                  ) : null}
                  {adhoc.map(row)}
                </>
              ) : null}
              {!localMatches && saved.length === 0 && adhoc.length === 0 ? (
                <li role="presentation" className="px-2 py-2 text-caption text-fg-subtle">
                  {t('sqlWorkspace.connection.noMatch')}
                </li>
              ) : null}
            </ul>
            {catalog ? (
              <div className="mt-1 border-t border-border-subtle pt-1">
                <button
                  type="button"
                  data-testid="sql-connection-new"
                  onClick={() => {
                    setOpen(false);
                    remote?.onNew();
                  }}
                  className="focus-ring flex h-8 w-full items-center gap-2 rounded-md px-2 text-body-sm text-accent-fg hover:bg-bg-panel-alt"
                >
                  <Plus size={12} aria-hidden="true" />
                  {t('sqlWorkspace.connection.new')}
                </button>
                <button
                  type="button"
                  data-testid="sql-connection-open-url"
                  onClick={() => {
                    setOpen(false);
                    remote?.onOpenUrl();
                  }}
                  className="focus-ring flex h-[30px] w-full items-center rounded-md px-2 text-body-sm text-fg-base hover:bg-bg-panel-alt"
                >
                  {t('sqlWorkspace.connection.openUrl')}
                </button>
                <button
                  type="button"
                  data-testid="sql-connection-manage"
                  onClick={() => {
                    setOpen(false);
                    remote?.onManage();
                  }}
                  className="focus-ring flex h-[30px] w-full items-center rounded-md px-2 text-body-sm text-fg-base hover:bg-bg-panel-alt"
                >
                  {t('sqlWorkspace.connection.manager.manage')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}
