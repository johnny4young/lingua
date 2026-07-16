import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../ui/chrome';
import { ContextualHint } from '../ui/ContextualHint';
import { ModalShell } from '../ui/ModalShell';
import { ModalFooterLegend } from '../ui/ModalFooterLegend';
import { CommandPaletteResults } from './CommandPaletteResults';
import { filterCommandPaletteCommands } from './commandPaletteModel';
import { useCommandPaletteCommands } from './useCommandPaletteCommands';
import type { CommandPaletteProps } from './commandPaletteTypes';

export type { CommandPaletteProps } from './commandPaletteTypes';

export function CommandPalette(props: CommandPaletteProps) {
  const { onClose } = props;
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // UX Sweep T6 — combobox/listbox semantics; aria-activedescendant points
  // at the active option so the highlighted command is announced while focus
  // stays in the search input.
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;
  const allCommands = useCommandPaletteCommands(props);
  const { t } = useTranslation();

  const filtered = useMemo(() => {
    return filterCommandPaletteCommands(allCommands, query);
  }, [allCommands, query]);
  const visibleSelectedIndex =
    filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${visibleSelectedIndex}"]`
    );
    element?.scrollIntoView({ block: 'nearest' });
  }, [visibleSelectedIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((currentIndex) => Math.min(currentIndex + 1, filtered.length - 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((currentIndex) => Math.max(currentIndex - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      filtered[visibleSelectedIndex]?.action();
      return;
    }

    // Escape (and scrim click) are handled by ModalShell's key handler on
    // the surrounding scrim — the event bubbles up from this input, so we
    // intentionally do not preventDefault/stopPropagation here.
  };

  return (
    <ModalShell
      onClose={onClose}
      size="max-w-[620px]"
      labelledById="command-palette-title"
      icon={<Search size={16} aria-hidden="true" />}
      header={
        <div className="flex items-center gap-3">
          <h2 id="command-palette-title" className="sr-only">
            {t('shortcuts.item.commandPalette.label')}
          </h2>
          <input
            ref={inputRef}
            data-tour-id="command-palette-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.search.placeholder')}
            aria-label={t('shortcuts.item.commandPalette.label')}
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              filtered.length > 0 ? optionId(visibleSelectedIndex) : undefined
            }
            className="min-w-0 flex-1 bg-transparent text-body text-fg-base outline-none placeholder:text-fg-subtle"
          />
          {query && (
            <Tooltip content={t('commandPalette.search.clear')}>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSelectedIndex(0);
                }}
                className="grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-bg-inset hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                aria-label={t('commandPalette.search.clear')}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      }
      footerLegend={<ModalFooterLegend navigate select close={false} />}
      trailing={
        // UX Sweep T4 — polite live region announcing the result count as
        // the query narrows, so screen-reader users hear matches/empty.
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="command-palette-result-count"
          className="font-mono text-caption text-fg-subtle"
        >
          {t('commandPalette.results.count', { count: filtered.length })}
        </span>
      }
    >
      <CommandPaletteResults
        commands={filtered}
        query={query}
        selectedIndex={visibleSelectedIndex}
        listRef={listRef}
        onHoverIndex={setSelectedIndex}
        listboxId={listboxId}
        optionId={optionId}
      />
      {filtered.length === 0 ? (
        <div className="px-4 pb-4">
          <ContextualHint surface="palette" />
        </div>
      ) : null}
    </ModalShell>
  );
}
