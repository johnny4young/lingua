import { createRunConsole } from '../runtime/execute/runAndCollect';
import { useConsoleStore } from '../stores/consoleStore';
import { nextTabRunNumber, useResultStore } from '../stores/resultStore';
import type { ConsoleOutput } from '../types/execution';
import type { Language } from '../types/language';
import { toConsoleEntry } from './runnerOutput';

/** The console side of one auto-run: its rows stream in while it runs, timed from its start. */
export interface AutoRunConsole {
  onConsole: (output: ConsoleOutput) => void;
  /** Deliver the queued rows; true when the run streamed any, so its outcome adds only the rest. */
  settle: (runNumber: number) => boolean;
  /** Give the console back to the run before, unless something newer took it over. */
  revert: () => void;
}

/**
 * Begin the console run of an auto-run. A run that is not `live` (Browser preview refreshes on every
 * keystroke and quietly stops without its panel) leaves the console alone until it settles.
 */
export function beginAutoRunConsole(
  tabId: string,
  language: Language,
  isCurrent: () => boolean,
  live: boolean
): AutoRunConsole {
  const store = useConsoleStore.getState();
  if (!live) {
    // Rows land at once, so the previous anchor must not make this run look live.
    store.dropRunAnchor();
    return {
      onConsole: () => undefined,
      settle: runNumber => {
        useConsoleStore.getState().beginRun({ tabId, startedAt: null, number: runNumber });
        return false;
      },
      revert: () => undefined,
    };
  }
  const { entries, collapsedEntries, currentRun, previousRun, hiddenPayloadKinds } = store;
  let before: Partial<typeof store> | null = { entries, collapsedEntries, currentRun, previousRun, hiddenPayloadKinds };
  store.beginRun({ tabId, startedAt: Date.now(), number: nextTabRunNumber(useResultStore.getState(), tabId) });
  const run = useConsoleStore.getState().currentRun;
  const runConsole = createRunConsole(isCurrent);
  return {
    onConsole: output => runConsole.add(toConsoleEntry(output, language)),
    settle: () => {
      before = null;
      runConsole.flush();
      if (runConsole.count() > 0) return true;
      useConsoleStore.getState().dropRunAnchor();
      return false;
    },
    revert: () => {
      if (before && useConsoleStore.getState().currentRun === run) useConsoleStore.setState(before);
    },
  };
}
