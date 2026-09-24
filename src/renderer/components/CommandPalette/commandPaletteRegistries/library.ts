import type { ExecutionHistoryEntry } from '../../../stores/executionHistoryStore';
import { languageLabel } from '../../../utils/languageMeta';
import {
  isNativeLanguageToolchain,
  nativeLanguageToolchainHintKey,
} from '../../../utils/nativeLanguageToolchainStatus';
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
    isWebBuild,
    nativeLanguageToolchainAvailability,
  } = args;

  const withNativeLanguageBoundary = (command: CommandEntry): CommandEntry => {
    if (!command.language || !isNativeLanguageToolchain(command.language)) return command;
    const boundary = isWebBuild
      ? translate('language.capability.desktopOnly')
      : nativeLanguageToolchainAvailability
        ? translate(
            nativeLanguageToolchainHintKey(nativeLanguageToolchainAvailability[command.language]),
            { toolchain: languageLabel(command.language) }
          )
        : null;
    if (!boundary) return command;
    return {
      ...command,
      description: `${command.description} · ${boundary}`,
      keywords: [...command.keywords, boundary.toLowerCase()],
    };
  };

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
      withNativeLanguageBoundary(buildTemplateCommand(template, createTab, createDefaultTab, onClose, t))
    ),
    ...snippets.map(snippet =>
      withNativeLanguageBoundary(buildSnippetCommand(snippet, createTab, createDefaultTab, onClose, translate))
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
