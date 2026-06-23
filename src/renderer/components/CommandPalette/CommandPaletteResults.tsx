import { Code, FileCode, Search, Zap } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  languageBadgeClass,
  languageShortLabel,
} from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { EmptyState } from '../ui/EmptyState';
import type { CommandCategory, CommandEntry } from './commandPaletteModel';

const CATEGORY_ICON: Record<CommandCategory, ReactNode> = {
  template: <FileCode size={14} aria-hidden="true" />,
  snippet: <Code size={14} aria-hidden="true" />,
  action: <Zap size={14} aria-hidden="true" />,
};

/**
 * Section order when the palette is showing the empty-query overview.
 * Actions go first because most palette traffic is system commands;
 * templates and snippets are creation flows that the user reaches for
 * less often. Recent runs ride along inside `action` (they are built
 * with `category: 'action'` in commandPaletteModel) so they stay
 * adjacent to the Re-run / layout actions in the eyebrow group.
 */
const SECTION_ORDER: readonly CommandCategory[] = ['action', 'template', 'snippet'];

const SECTION_LABEL_KEY: Record<CommandCategory, string> = {
  action: 'commandPalette.scope.actions',
  template: 'commandPalette.scope.templates',
  snippet: 'commandPalette.scope.snippets',
};

interface CommandPaletteResultsProps {
  commands: CommandEntry[];
  /**
   * The current query string. When empty we render a grouped view with
   * eyebrow section headers so the palette behaves like a launcher; on
   * any non-empty query we render a flat ranked list so search results
   * are not split across sections.
   */
  query: string;
  selectedIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  onHoverIndex: (index: number) => void;
}

export function CommandPaletteResults({
  commands,
  query,
  selectedIndex,
  listRef,
  onHoverIndex,
}: CommandPaletteResultsProps) {
  const { t } = useTranslation();
  const isEmptyQuery = query.trim().length === 0;

  return (
    <div ref={listRef}>
      {commands.length === 0 ? (
        <div className="px-4 py-10">
          <EmptyState
            icon={<Search size={18} aria-hidden="true" />}
            title={t('commandPalette.results.empty', { query })}
            description={t('commandPalette.results.empty.hint')}
          />
        </div>
      ) : isEmptyQuery ? (
        renderGrouped(commands, t, selectedIndex, onHoverIndex)
      ) : (
        commands.map((command, index) =>
          renderEntry(command, index, selectedIndex, onHoverIndex)
        )
      )}
    </div>
  );
}

function renderEntry(
  command: CommandEntry,
  index: number,
  selectedIndex: number,
  onHoverIndex: (index: number) => void
) {
  const isActive = index === selectedIndex;
  return (
    <button
      key={command.id}
      type="button"
      onClick={command.action}
      onMouseEnter={() => onHoverIndex(index)}
      data-result-index={index}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-[9px] text-left transition-colors',
        isActive
          ? 'border-accent/40 bg-primary-soft'
          : 'border-transparent hover:bg-bg-panel-alt'
      )}
    >
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-panel-alt',
          isActive ? 'text-accent' : 'text-fg-muted'
        )}
      >
        {CATEGORY_ICON[command.category]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-fg-base">
          {command.label}
        </span>
        <span className="truncate text-body-sm text-fg-subtle">
          {command.description}
        </span>
      </div>
      {command.language && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-eyebrow font-bold uppercase tracking-[0.14em] ${languageBadgeClass(command.language)}`}
        >
          {languageShortLabel(command.language)}
        </span>
      )}
    </button>
  );
}

function renderGrouped(
  commands: CommandEntry[],
  t: (key: string) => string,
  selectedIndex: number,
  onHoverIndex: (index: number) => void
) {
  // Bucket commands by category while preserving the original index in
  // the flat list so keyboard navigation (which is index-based on the
  // unchanged filtered array) still highlights the right entry.
  const buckets: Record<CommandCategory, Array<{ command: CommandEntry; index: number }>> = {
    action: [],
    template: [],
    snippet: [],
  };
  commands.forEach((command, index) => {
    buckets[command.category].push({ command, index });
  });

  return SECTION_ORDER.flatMap((category) => {
    const bucket = buckets[category];
    if (bucket.length === 0) return [];
    return [
      <p
        key={`section-${category}`}
        className="panel-title px-3 pt-3 pb-1.5"
        role="presentation"
      >
        {t(SECTION_LABEL_KEY[category])}
      </p>,
      ...bucket.map(({ command, index }) =>
        renderEntry(command, index, selectedIndex, onHoverIndex)
      ),
    ];
  });
}
