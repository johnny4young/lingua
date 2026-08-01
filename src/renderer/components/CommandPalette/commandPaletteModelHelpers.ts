/** Shared command constructors. Domain registries own composition. */

import type { TFunction } from 'i18next';
import {
  resolveTemplateDescription,
  resolveTemplateFileStem,
  resolveTemplateLabel,
  type Template,
} from '../../data/templates';
import { formatExecTime } from '../../hooks/runnerOutput';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';
import type { Snippet } from '../../stores/snippetsStore';
import type { FileTab } from '../../types/editor';
import type { Language } from '../../types/language';
import { extensionForLanguage, languageLabel } from '../../utils/languageMeta';
import type { CommandEntry } from './commandPaletteModelTypes';

export function normalizeKeywords(values: Array<string | undefined>) {
  return values.map(value => value?.toLowerCase() ?? '');
}

export function buildTemplateCommand(
  template: Template,
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void,
  createDefaultTab: (language: Language) => FileTab,
  onClose: () => void,
  t?: TFunction
): CommandEntry {
  const label = resolveTemplateLabel(template, t);
  const description = resolveTemplateDescription(template, t);
  const fileStem = resolveTemplateFileStem(template);

  return {
    id: `tpl-${template.id}`,
    category: 'template',
    label,
    description,
    language: template.language,
    // Keep the English `fileStem` in the keyword index so the command palette
    // stays bilingually searchable even when the active locale is not `en`
    // (see implementation: discoverability aliases must survive localization).
    keywords: normalizeKeywords([label, fileStem, template.language, description]),
    action: () => {
      const tab = createDefaultTab(template.language);
      createTab({
        ...tab,
        content: template.code,
        name: `${fileStem}.${extensionForLanguage(template.language)}`,
      });
      onClose();
    },
  };
}

export function buildSnippetCommand(
  snippet: Snippet,
  createTab: (tab: Omit<FileTab, 'isDirty'>) => void,
  createDefaultTab: (language: Language) => FileTab,
  onClose: () => void,
  translate: (key: string) => string
): CommandEntry {
  return {
    id: `sn-${snippet.id}`,
    category: 'snippet',
    label: snippet.label,
    description: snippet.description || translate('commandPalette.snippet.fallbackDescription'),
    language: snippet.language,
    keywords: normalizeKeywords([snippet.label, snippet.language, snippet.description]),
    action: () => {
      const tab = createDefaultTab(snippet.language);
      createTab({
        ...tab,
        content: snippet.code,
        name: `${snippet.label}.${extensionForLanguage(snippet.language)}`,
      });
      onClose();
    },
  };
}

export function buildActionCommand(
  id: string,
  label: string,
  description: string,
  keywords: string[],
  action: () => void
): CommandEntry {
  return {
    id,
    category: 'action',
    label,
    description,
    keywords: normalizeKeywords(keywords),
    action,
  };
}

/**
 * Minimal fallback when no TFunction is supplied — returns the last segment
 * of the key in Title Case so legacy callers still render something readable
 * rather than a raw dot-notation string.
 */
export function identityTranslate(key: string): string {
  const segment = key.split('.').pop() ?? key;
  return segment.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}

/**
 * implementation — surface up to 5 recent runs as palette actions.
 * Label format is `{{language}} · {{status}} · {{duration}}`,
 * all localized. `onFocusLanguageTab` is optional; when it's missing
 * the action just closes the palette (a harmless "I saw the entry"
 * acknowledgement, same as every other palette item without a caller).
 */
export const MAX_RECENT_RUNS_IN_PALETTE = 5;

export function buildRecentRunCommand(
  entry: ExecutionHistoryEntry,
  onClose: () => void,
  translate: (key: string, options?: Record<string, unknown>) => string,
  onFocusLanguageTab?: (language: Language) => void
): CommandEntry {
  const statusKey =
    entry.status === 'ok'
      ? 'commandPalette.recentRuns.status.ok'
      : 'commandPalette.recentRuns.status.error';
  const languageName = languageLabel(entry.language as Language);
  const label = translate('commandPalette.recentRuns.label', {
    language: languageName,
    status: translate(statusKey),
    duration: formatExecTime(entry.durationMs ?? 0),
  });
  const description = translate('commandPalette.recentRuns.description');

  return {
    id: `recent-run-${entry.id}`,
    category: 'action',
    label,
    description,
    language: entry.language as Language,
    keywords: normalizeKeywords([
      label,
      description,
      entry.language,
      entry.status,
      'recent',
      'run',
    ]),
    action: () => {
      onFocusLanguageTab?.(entry.language as Language);
      onClose();
    },
  };
}

/**
 * implementation note — parallel "Recent runs (this tab)" entry.
 * Same shape as `buildRecentRunCommand` but labels itself with a
 * dedicated copy key so the palette result list visibly distinguishes
 * per-tab entries from the legacy global group. The action is
 * identical (focuses the language tab), letting users use either
 * group interchangeably.
 */
export function buildRecentRunOnTabCommand(
  entry: ExecutionHistoryEntry,
  onClose: () => void,
  translate: (key: string, options?: Record<string, unknown>) => string,
  onFocusLanguageTab?: (language: Language) => void
): CommandEntry {
  const statusKey =
    entry.status === 'ok'
      ? 'commandPalette.recentRuns.status.ok'
      : 'commandPalette.recentRuns.status.error';
  const languageName = languageLabel(entry.language as Language);
  const label = translate('commandPalette.recentRuns.onTab.label', {
    language: languageName,
    status: translate(statusKey),
    duration: formatExecTime(entry.durationMs ?? 0),
  });
  const description = translate('commandPalette.recentRuns.onTab.description');

  return {
    id: `recent-run-tab-${entry.id}`,
    category: 'action',
    label,
    description,
    language: entry.language as Language,
    keywords: normalizeKeywords([
      label,
      description,
      entry.language,
      entry.status,
      'recent',
      'run',
      'tab',
      'this',
    ]),
    action: () => {
      onFocusLanguageTab?.(entry.language as Language);
      onClose();
    },
  };
}

/**
 * implementation trailer — per-entry Replay command.
 *
 * Emitted only for snapshot-bearing entries so the user can fuzzy-search
 * "replay python ok 1.2s" and re-run any of the recent captures from the
 * keyboard. The popover Replay button covers the same intent for mouse
 * users; the palette mirror keeps the keyboard-driven flow first-class
 * for Lingua's senior-dev audience.
 *
 * Activation hands the entry to `onReplayEntry`, which is wired in
 * `App.tsx` to the shared `replayHistoryEntry` helper. The helper
 * runs with `lifecycle.recordHistory: false` so no second history
 * entry is appended.
 */
export function buildReplayHistoryCommand(
  entry: ExecutionHistoryEntry,
  onClose: () => void,
  translate: (key: string, options?: Record<string, unknown>) => string,
  onReplayEntry: (entry: ExecutionHistoryEntry) => void
): CommandEntry {
  const statusKey =
    entry.status === 'ok'
      ? 'commandPalette.recentRuns.status.ok'
      : 'commandPalette.recentRuns.status.error';
  const languageName = languageLabel(entry.language as Language);
  const label = translate('executionHistory.palette.replay.label', {
    language: languageName,
    status: translate(statusKey),
    duration: formatExecTime(entry.durationMs ?? 0),
  });
  const description = translate('executionHistory.palette.replay.description');

  return {
    id: `action-replay-${entry.id}`,
    category: 'action',
    label,
    description,
    language: entry.language as Language,
    keywords: normalizeKeywords([
      label,
      description,
      entry.language,
      entry.status,
      'replay',
      'snapshot',
      'history',
      'recent',
      'run',
      'reproduce',
    ]),
    action: () => {
      onReplayEntry(entry);
      onClose();
    },
  };
}
