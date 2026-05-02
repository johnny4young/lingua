/**
 * RL-028 Slice 6 trailer — shared replay helper.
 *
 * Both the console-popover Replay button (Slice 6) and the command-palette
 * per-entry Replay action (this slice) dispatch the same effect: open a new
 * tab seeded with the captured snapshot's code/language, then run it without
 * appending another entry to the execution-history timeline.
 *
 * Privacy posture preserved: snapshots stay in memory only. The helper
 * neither persists, broadcasts, nor logs the captured code.
 */
import { extensionForLanguage, languageLabel } from './languageMeta';
import { useEditorStore } from '../stores/editorStore';
import type { ExecutionHistoryEntry } from '../stores/executionHistoryStore';
import { useUIStore } from '../stores/uiStore';
import type { FileTab, Language } from '../types';

export interface ReplayHistoryEntryDeps {
  /** Whether a run is currently in progress; replay refuses to fire on top of one. */
  isRunning: boolean;
  /**
   * Run dispatcher from `useRunner()`. Replay always passes
   * `recordHistory: false` so dispatching a captured run does not
   * append a second entry to the same timeline.
   */
  run: (options?: { recordHistory?: boolean }) => Promise<unknown> | void;
}

function nextReplayTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `history-replay-${Date.now().toString(36)}`;
}

function replayTabName(entry: ExecutionHistoryEntry, language: Language): string {
  const suffix = entry.id.replace(/[^a-z0-9]/gi, '').slice(-8) || 'history';
  return `replay-${suffix}.${extensionForLanguage(language)}`;
}

/**
 * Replay a captured execution-history entry: open a new tab seeded with
 * the snapshot, then dispatch the run. No history entry is appended.
 *
 * Refuses (with a translated status notice) when:
 *   - a run is already in progress (`replay.running`),
 *   - the entry has no captured snapshot (`replay.noSnapshot`),
 *   - the addTab tier ceiling rejected the new tab (`replay.openFailed`).
 *
 * Returns nothing; surfaces all feedback through `useUIStore` notices.
 */
export function replayHistoryEntry(
  entry: ExecutionHistoryEntry,
  deps: ReplayHistoryEntryDeps
): void {
  const { isRunning, run } = deps;

  if (isRunning) {
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'executionHistory.replay.running',
    });
    return;
  }

  if (!entry.snapshot) {
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'executionHistory.replay.noSnapshot',
      values: { language: languageLabel(entry.language as Language) },
    });
    return;
  }

  const language = entry.snapshot.language as Language;
  const replayTab: FileTab = {
    id: nextReplayTabId(),
    name: replayTabName(entry, language),
    language,
    content: entry.snapshot.code,
    isDirty: false,
  };

  useEditorStore.getState().addTab(replayTab);
  if (useEditorStore.getState().activeTabId !== replayTab.id) {
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'executionHistory.replay.openFailed',
      values: { language: languageLabel(language) },
    });
    return;
  }

  void run({ recordHistory: false });
}
