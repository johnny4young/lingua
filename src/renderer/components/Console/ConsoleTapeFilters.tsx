import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConsoleEntry, ConsoleLevel } from '../../types/console';
import { entryMatchesLevel } from '../../utils/consoleTape';
import { IconButton } from '../ui/chrome';
import { ICON_GLYPH } from '../ui/iconScale';

const LEVELS: ConsoleLevel[] = ['all', 'log', 'warn', 'error'];

/** All / Log / Warn / Error, each with the number of rows it would show. */
export function ConsoleLevelSegment({
  entries,
  level,
  onSelect,
}: {
  entries: readonly ConsoleEntry[];
  level: ConsoleLevel;
  onSelect: (level: ConsoleLevel) => void;
}) {
  const { t } = useTranslation();
  const counts = useMemo(() => {
    const totals: Record<ConsoleLevel, number> = { all: 0, log: 0, warn: 0, error: 0 };
    for (const entry of entries) {
      for (const option of LEVELS) if (entryMatchesLevel(entry.type, option)) totals[option] += 1;
    }
    return totals;
  }, [entries]);

  return (
    <div
      role="group"
      aria-label={t('console.level.label')}
      className="console-level flex overflow-hidden rounded-md border border-border-subtle text-[11.5px]"
    >
      {LEVELS.map(option => (
        <button
          key={option}
          type="button"
          aria-pressed={level === option}
          data-testid={`console-level-${option}`}
          onClick={() => onSelect(option)}
          className={`focus-ring whitespace-nowrap px-[9px] py-0.5 transition-colors ${
            level === option ? 'bg-surface-strong text-foreground' : 'text-fg-muted hover:text-foreground'
          }`}
        >
          {t(`console.level.${option}`)}
          {counts[option] > 0 ? <span className="ml-1 tabular-nums">{counts[option]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Search toggle that reveals a text filter; closing it clears the filter. */
export function ConsoleSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = () => {
    onQueryChange('');
    setOpen(false);
  };

  return (
    <>
      {open ? (
        <input
          autoFocus
          type="search"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            close();
          }}
          placeholder={t('console.search.placeholder')}
          aria-label={t('console.search.placeholder')}
          data-testid="console-search-input"
          className="focus-ring h-6 w-44 min-w-0 shrink rounded-md border border-border-subtle bg-transparent px-2 text-[11.5px] text-foreground placeholder:text-fg-subtle"
        />
      ) : null}
      <IconButton
        onClick={() => (open ? close() : setOpen(true))}
        active={open}
        tooltip={open ? t('console.search.close') : t('console.search.open')}
        data-testid="console-search-toggle"
      >
        <Search size={ICON_GLYPH.md} />
      </IconButton>
    </>
  );
}
