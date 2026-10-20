import { AppWindow, Braces, FileCode, History, Search, Wrench, Zap } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ShortcutOverrideMap } from '../../data/keyboardShortcuts';
import { Kbd } from '../ui/ModalShell';
import {
  languageBadgeClass,
  languageShortLabel,
} from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { EmptyState } from '../ui/EmptyState';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import type { CommandEntry } from './commandPaletteModel';
import {
  COMMAND_GROUP_LABEL_KEY,
  commandGroupFor,
  commandShortcutLabel,
  type CommandGroup,
  type CommandGroupId,
} from './commandPaletteGroups';

const GROUP_ICON: Record<CommandGroupId, ReactNode> = {
  recent: <History size={14} aria-hidden="true" />,
  workspaces: <AppWindow size={14} aria-hidden="true" />,
  commands: <Zap size={14} aria-hidden="true" />,
  utilities: <Wrench size={14} aria-hidden="true" />,
  templates: <FileCode size={14} aria-hidden="true" />,
  snippets: <Braces size={14} aria-hidden="true" />,
};

interface CommandPaletteResultsProps {
  commands: CommandEntry[];
  /** The rows bucketed under eyebrows, in the same order as `commands`. Absent for the recent stack. */
  groups?: CommandGroup[] | null;
  query: string;
  selectedIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  onHoverIndex: (index: number) => void;
  /** id for the listbox container (the combobox input's aria-controls). */
  listboxId: string;
  /** Stable per-row option id, for the input's aria-activedescendant. */
  optionId: (index: number) => string;
  /**
   * Present ONLY in the Cmd+; recent-commands variant: maps a
   * command id to its last execution epoch. Switches the list to a flat
   * numbered stack (1-8 badges + relative "2m ago" column) and skips
   * the category grouping.
   */
  recentTimestamps?: ReadonlyMap<string, number>;
}

export function CommandPaletteResults({
  commands,
  groups,
  query,
  selectedIndex,
  listRef,
  onHoverIndex,
  listboxId,
  optionId,
  recentTimestamps,
}: CommandPaletteResultsProps) {
  const { t } = useTranslation();
  const paletteCombo = useShortcutLabel('overlay-command-palette');
  const quickOpenCombo = useShortcutLabel('nav-quick-open');
  const overrides = useSettingsStore(state => state.shortcutOverrides);
  const isRecentStack = recentTimestamps !== undefined;

  return (
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      aria-label={t(
        isRecentStack
          ? 'commandPalette.recent.title'
          : 'shortcuts.item.commandPalette.label'
      )}
    >
      {commands.length === 0 ? (
        <div className="px-4 py-10">
          <EmptyState
            icon={<Search size={18} aria-hidden="true" />}
            title={t(
              isRecentStack ? 'commandPalette.recent.empty' : 'commandPalette.results.empty',
              { query }
            )}
            description={
              isRecentStack
                ? t('commandPalette.recent.empty.hint', { combo: paletteCombo })
                : t('commandPalette.results.empty.hint', { combo: quickOpenCombo })
            }
          />
        </div>
      ) : isRecentStack || !groups ? (
        commands.map((command, index) =>
          renderEntry(command, index, selectedIndex, onHoverIndex, optionId, overrides, null, {
            slot: index + 1,
            relativeTime: relativeTimeLabel(t, recentTimestamps?.get(command.id)),
          })
        )
      ) : (
        renderGrouped(groups, t, selectedIndex, onHoverIndex, optionId, overrides)
      )}
    </div>
  );
}

/**
 * Compact relative timestamp for the recent stack. Reuses the
 * existing `executionHistory.relative.*` plural keys so the palette and
 * the Recent-runs pill describe time identically.
 */
function relativeTimeLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  executedAt: number | undefined
): string | null {
  if (executedAt === undefined) return null;
  const elapsedMs = Math.max(0, Date.now() - executedAt);
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 60) return t('executionHistory.relative.seconds', { count: Math.max(1, seconds) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('executionHistory.relative.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  return t('executionHistory.relative.hours', { count: hours });
}

function renderEntry(
  command: CommandEntry,
  index: number,
  selectedIndex: number,
  onHoverIndex: (index: number) => void,
  optionId: (index: number) => string,
  overrides: ShortcutOverrideMap,
  group: CommandGroupId | null,
  recentMeta?: { slot: number; relativeTime: string | null }
) {
  const isActive = index === selectedIndex;
  const shortcut = commandShortcutLabel(command, overrides);
  return (
    <button
      key={command.id}
      type="button"
      id={optionId(index)}
      role="option"
      aria-selected={isActive}
      aria-disabled={command.disabled || undefined}
      disabled={command.disabled}
      // The combobox input is the single tab stop; options are reached via
      // the arrow keys + aria-activedescendant, not the Tab sequence.
      tabIndex={-1}
      onClick={command.action}
      onMouseEnter={() => onHoverIndex(index)}
      data-result-index={index}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-[9px] text-left transition-colors',
        command.disabled
          ? 'cursor-not-allowed border-transparent opacity-55'
          : isActive
          ? 'border-accent/40 bg-primary-soft'
          : 'border-transparent hover:bg-bg-panel-alt'
      )}
    >
      {recentMeta ? (
        <kbd
          data-testid="recent-command-slot"
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-panel-alt font-mono text-body-sm font-semibold',
            isActive ? 'text-accent' : 'text-fg-muted'
          )}
        >
          {recentMeta.slot}
        </kbd>
      ) : (
        <span
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-panel-alt',
            isActive ? 'text-accent' : 'text-fg-muted'
          )}
        >
          {GROUP_ICON[group ?? commandGroupFor(command)]}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-fg-base">
          {command.label}
        </span>
        <span className="truncate text-body-sm text-fg-subtle">
          {command.description}
        </span>
      </div>
      {recentMeta?.relativeTime ? (
        <span
          data-testid="recent-command-time"
          className="shrink-0 font-mono text-caption text-fg-subtle"
        >
          {recentMeta.relativeTime}
        </span>
      ) : null}
      {/* Keycap column: the command's shortcut or its language, then ↵ on the active row. */}
      <span className="flex shrink-0 items-center gap-1.5" data-testid="command-palette-keycaps">
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        {command.language ? (
          <span
            className={`rounded-full px-2 py-0.5 text-eyebrow font-bold uppercase tracking-[0.14em] ${languageBadgeClass(command.language)}`}
          >
            {languageShortLabel(command.language)}
          </span>
        ) : null}
        {isActive && !command.disabled ? (
          <Kbd className="border-accent text-accent-fg">↵</Kbd>
        ) : null}
      </span>
    </button>
  );
}

function renderGrouped(
  groups: readonly CommandGroup[],
  t: (key: string) => string,
  selectedIndex: number,
  onHoverIndex: (index: number) => void,
  optionId: (index: number) => string,
  overrides: ShortcutOverrideMap
) {
  // Rows keep their index in the flat ordered list, so keyboard navigation
  // (index-based) highlights the row the user sees.
  let index = 0;
  return groups.flatMap(group => [
    <p
      key={`section-${group.id}`}
      data-testid={`command-palette-group-${group.id}`}
      className="px-2.5 pb-1 pt-2 text-eyebrow font-semibold uppercase tracking-[0.16em] text-fg-subtle first:pt-1.5"
      role="presentation"
    >
      {t(COMMAND_GROUP_LABEL_KEY[group.id])}
    </p>,
    ...group.commands.map(command =>
      renderEntry(command, index++, selectedIndex, onHoverIndex, optionId, overrides, group.id)
    ),
  ]);
}
