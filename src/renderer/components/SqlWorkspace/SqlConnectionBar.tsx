import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface SqlConnectionBarProps {
  /** Right-aligned actions (Import data). */
  actions?: ReactNode;
}

const LOCAL_ENGINE = 'DuckDB';

/** The Local connection chip, shared by the pill and its picker row. */
function LocalChip() {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent-fg" />
      <span className="text-body-sm text-fg-base">{t('sqlWorkspace.connection.localName')}</span>
      <span className="font-mono text-caption text-fg-muted">{LOCAL_ENGINE}</span>
    </>
  );
}

/**
 * Connection toolbar of the SQL tab. Local (DuckDB) is the only connection
 * today and the first entry of the picker; saved connections join it later.
 */
export function SqlConnectionBar({ actions }: SqlConnectionBarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();
  const optionRef = useRef<HTMLLIElement | null>(null);
  const choose = () => {
    setOpen(false);
    pillRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
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
  const needle = search.trim().toLowerCase();
  const localMatches =
    needle.length === 0 || `${localName} ${LOCAL_ENGINE}`.toLowerCase().includes(needle);

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
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={t('sqlWorkspace.connection.pillAria', {
            name: `${localName} ${LOCAL_ENGINE}`,
          })}
          onClick={() => {
            setSearch('');
            setOpen(value => !value);
          }}
          className="focus-ring inline-flex h-[26px] items-center gap-[7px] rounded-[7px] border border-accent-fg bg-accent-tint px-[9px]"
        >
          <LocalChip />
          <ChevronDown size={11} aria-hidden="true" className="text-fg-muted" />
        </button>
        {open ? (
          <div
            data-testid="sql-connection-picker"
            className="absolute left-0 top-[calc(100%+0.375rem)] z-50 w-[350px] rounded-[10px] border border-border-default bg-bg-panel p-1.5 shadow-e3"
          >
            <input
              type="search"
              autoFocus
              value={search}
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  optionRef.current?.focus();
                }
              }}
              placeholder={t('sqlWorkspace.connection.find')}
              aria-label={t('sqlWorkspace.connection.find')}
              data-testid="sql-connection-search"
              className="h-[26px] w-full rounded-md border border-border-default bg-bg-inset px-2 text-body-sm text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
            />
            <p className="px-2 pb-[3px] pt-[7px] font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
              {t('sqlWorkspace.connection.thisDevice')}
            </p>
            <ul id={listId} role="listbox" aria-label={t('sqlWorkspace.connection.listAria')}>
              {localMatches ? (
                <li
                  ref={optionRef}
                  role="option"
                  aria-selected="true"
                  data-testid="sql-connection-option-local"
                  tabIndex={-1}
                  onClick={choose}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      choose();
                    }
                  }}
                  className="focus-ring flex h-8 cursor-pointer items-center gap-[7px] rounded-md bg-accent-tint px-2"
                >
                  <LocalChip />
                  <span className="ml-auto font-mono text-caption text-fg-muted">
                    {t('sqlWorkspace.connection.localDefault')}
                  </span>
                  <Check size={12} aria-hidden="true" className="text-accent-fg" />
                </li>
              ) : (
                <li className="px-2 py-2 text-caption text-fg-subtle">
                  {t('sqlWorkspace.connection.noMatch')}
                </li>
              )}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}
