import { Code, FileCode, Zap } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  languageBadgeClass,
  languageShortLabel,
} from '../../utils/languageMeta';
import type { CommandCategory, CommandEntry } from './commandPaletteModel';

const CATEGORY_ICON: Record<CommandCategory, ReactNode> = {
  template: <FileCode size={13} className="shrink-0 text-primary" />,
  snippet: <Code size={13} className="shrink-0 text-info" />,
  action: <Zap size={13} className="shrink-0 text-warning" />,
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
    <div ref={listRef} className="max-h-[26rem] overflow-y-auto px-2 py-2">
      {commands.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-sm text-muted">
            {t('commandPalette.results.empty', { query })}
          </p>
          <p className="text-xs text-muted/80">
            {t('commandPalette.results.empty.hint')}
          </p>
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
  return (
    <button
      key={command.id}
      type="button"
      onClick={command.action}
      onMouseEnter={() => onHoverIndex(index)}
      data-result-index={index}
      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
        index === selectedIndex ? 'bg-primary-soft' : 'hover:bg-surface-strong/68'
      }`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-surface-strong/82">
        {CATEGORY_ICON[command.category]}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {command.label}
        </span>
        <span className="truncate text-xs text-muted">{command.description}</span>
      </div>
      {command.language && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${languageBadgeClass(command.language)}`}
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
