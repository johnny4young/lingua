import type { ExecutionHistoryEntry } from '../../../stores/executionHistoryStore';
import {
  MAX_RECENT_RUNS_IN_PALETTE,
  buildRecentRunCommand,
  buildRecentRunOnTabCommand,
  buildReplayHistoryCommand,
  buildSnippetCommand,
  buildTemplateCommand,
} from '../commandPaletteModelHelpers';
import type { CommandEntry, CommandPaletteRegistry } from '../commandPaletteModelTypes';

export const buildLibraryCommands: CommandPaletteRegistry = ({ args, translate }) => {
  const {
    templates,
    snippets,
    executionHistory,
    onFocusLanguageTab,
    onReplayEntry,
    activeTabId = null,
    createTab,
    createDefaultTab,
    onClose,
    t,
  } = args;

  const recentRunEntries = (executionHistory ?? [])
    // Store keeps entries oldest → newest; palette wants newest first.
    .slice(-MAX_RECENT_RUNS_IN_PALETTE)
    .reverse();

  // implementation note — per-tab recent runs ranked above the
  // global group when the active tab has at least one matching
  // entry. Same `MAX_RECENT_RUNS_IN_PALETTE` ceiling so neither
  // group dominates the palette.
  const recentRunOnTabEntries =
    activeTabId !== null && activeTabId !== undefined
      ? (executionHistory ?? [])
          .filter(entry => entry.tabId === activeTabId)
          .slice(-MAX_RECENT_RUNS_IN_PALETTE)
          .reverse()
      : [];

  // Per-entry Replay commands share the same recent-history window before
  // metadata-only entries drop out, so stale snapshots cannot outrank the
  // latest executions just because newer entries did not capture code.
  const replayHistoryEntries = onReplayEntry
    ? (executionHistory ?? [])
        .slice(-MAX_RECENT_RUNS_IN_PALETTE)
        .filter(entry => entry.snapshot !== null)
        .reverse()
    : [];

  const commands: CommandEntry[] = [
    ...templates.map(template =>
      buildTemplateCommand(template, createTab, createDefaultTab, onClose, t)
    ),
    ...snippets.map(snippet =>
      buildSnippetCommand(snippet, createTab, createDefaultTab, onClose, translate)
    ),
    // implementation note — per-tab group FIRST so the user sees
    // "what I just ran on this tab" before the global recents.
    ...recentRunOnTabEntries.map(entry =>
      buildRecentRunOnTabCommand(entry, onClose, translate, onFocusLanguageTab)
    ),
    ...recentRunEntries.map(entry =>
      buildRecentRunCommand(entry, onClose, translate, onFocusLanguageTab)
    ),
    ...replayHistoryEntries.map(entry =>
      buildReplayHistoryCommand(
        entry,
        onClose,
        translate,
        onReplayEntry as (entry: ExecutionHistoryEntry) => void
      )
    ),
  ];

  return commands;
};
