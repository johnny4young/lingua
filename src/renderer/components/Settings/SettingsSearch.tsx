import { useEffect, useState, type RefObject } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { Kbd } from '../ui/chrome';
import type { SettingsSearchResult } from './settingsSearchModel';

interface SettingsSearchProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  results: readonly SettingsSearchResult[];
  onQueryChange: (query: string) => void;
  onSelect: (result: SettingsSearchResult) => void;
}

export function SettingsSearch({
  inputRef,
  query,
  results,
  onQueryChange,
  onSelect,
}: SettingsSearchProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const safeActiveIndex =
    results.length === 0
      ? 0
      : Math.min(activeIndex, results.length - 1);
  const expanded = query.trim().length > 0;

  useEffect(() => {
    const activeResult = results[safeActiveIndex];
    if (!expanded || !activeResult) return;
    document
      .getElementById(`settings-search-result-${activeResult.id}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, results, safeActiveIndex]);

  const changeQuery = (nextQuery: string) => {
    setActiveIndex(0);
    onQueryChange(nextQuery);
  };

  return (
    <div className="relative mx-2 min-w-0 flex-1">
      <div
        className={cn(
          'flex h-7 min-w-0 items-center gap-2 rounded-md border bg-bg-base px-2.5 transition-colors',
          query ? 'border-accent bg-primary-soft' : 'border-border/80'
        )}
      >
        <Search
          size={12}
          className={cn(query ? 'text-accent-fg' : 'text-fg-subtle')}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          value={query}
          onChange={event => changeQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' && results.length > 0) {
              event.preventDefault();
              setActiveIndex((safeActiveIndex + 1) % results.length);
              return;
            }
            if (event.key === 'ArrowUp' && results.length > 0) {
              event.preventDefault();
              setActiveIndex(
                (safeActiveIndex - 1 + results.length) % results.length
              );
              return;
            }
            if (event.key === 'Enter') {
              const result = results[safeActiveIndex];
              if (result) {
                event.preventDefault();
                onSelect(result);
              }
              return;
            }
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              event.stopPropagation();
              changeQuery('');
            }
          }}
          placeholder={t('settings.filter.placeholder')}
          className={cn(
            'min-w-0 flex-1 bg-transparent font-mono text-body-sm outline-none placeholder:text-fg-subtle',
            query ? 'font-semibold text-accent-fg' : 'text-fg-muted'
          )}
          data-testid="settings-filter-input"
          aria-label={t('settings.filter.placeholder')}
          aria-expanded={expanded}
          aria-controls={expanded ? 'settings-search-results' : undefined}
          aria-activedescendant={
            results[safeActiveIndex]
              ? `settings-search-result-${results[safeActiveIndex].id}`
              : undefined
          }
          autoComplete="off"
        />
        {query ? (
          <>
            <span className="font-mono text-eyebrow text-accent-fg">
              {results.length === 0
                ? t('settings.filter.noMatches')
                : t('settings.filter.matches', { count: results.length })}
            </span>
            <button
              type="button"
              onClick={() => {
                changeQuery('');
                inputRef.current?.focus();
              }}
              className="text-accent-fg hover:opacity-70"
              aria-label={t('settings.filter.clear')}
            >
              <X size={11} aria-hidden />
            </button>
          </>
        ) : (
          <span className="flex gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>,</Kbd>
          </span>
        )}
      </div>

      {expanded ? (
        <div
          id="settings-search-results"
          role="listbox"
          aria-label={t('settings.filter.resultsLabel')}
          className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-50 max-h-[22rem] overflow-y-auto rounded-lg border border-border bg-bg-panel p-1.5 shadow-2xl"
          data-testid="settings-search-results"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-body-sm text-fg-subtle">
              {t('settings.filter.noMatches')}
            </p>
          ) : (
            results.map((result, index) => {
              const selected = index === safeActiveIndex;
              return (
                <button
                  key={result.id}
                  id={`settings-search-result-${result.id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left',
                    selected
                      ? 'bg-primary-soft text-fg-base'
                      : 'text-fg-muted hover:bg-bg-inset hover:text-fg-base'
                  )}
                  data-testid={`settings-search-result-${result.id}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onSelect(result)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium">
                      {result.label}
                    </span>
                    {result.description ? (
                      <span className="mt-0.5 block truncate text-caption text-fg-subtle">
                        {result.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-eyebrow uppercase text-fg-subtle">
                    {result.tabLabel}
                  </span>
                  <ArrowRight size={12} className="shrink-0 text-accent" aria-hidden />
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
