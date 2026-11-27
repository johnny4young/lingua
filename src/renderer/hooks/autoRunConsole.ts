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

// The unsettled live auto-run and the console it found, so a run replacing it reverts past it.
let inFlight: { run: unknown; before: object } | null = null;

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
    const anchored = store.currentRun;
    store.dropRunAnchor();
    const dropped = useConsoleStore.getState().currentRun;
    return {
      onConsole: () => undefined,
      settle: runNumber => {
        useConsoleStore.getState().beginRun({ tabId, startedAt: null, number: runNumber });
        return false;
      },
      revert: () => {
        if (dropped !== anchored && useConsoleStore.getState().currentRun === dropped) {
          useConsoleStore.setState({ currentRun: anchored });
        }
      },
    };
  }
  const { entries, collapsedEntries, currentRun, previousRun, hiddenPayloadKinds } = store;
  const superseded = inFlight && inFlight.run === currentRun ? (inFlight.before as Partial<typeof store>) : null;
  let before: Partial<typeof store> | null =
    superseded ?? { entries, collapsedEntries, currentRun, previousRun, hiddenPayloadKinds };
  store.beginRun({ tabId, startedAt: Date.now(), number: nextTabRunNumber(useResultStore.getState(), tabId) });
  const run = useConsoleStore.getState().currentRun;
  inFlight = { run, before };
  const release = () => {
    if (inFlight?.run === run) inFlight = null;
  };
  const runConsole = createRunConsole(isCurrent);
  return {
    onConsole: output => runConsole.add(toConsoleEntry(output, language)),
    settle: () => {
      before = null;
      release();
      runConsole.flush();
      if (runConsole.count() > 0) return true;
      useConsoleStore.getState().dropRunAnchor();
      return false;
    },
    revert: () => {
      release();
      if (before && useConsoleStore.getState().currentRun === run) useConsoleStore.setState(before);
    },
  };
}
