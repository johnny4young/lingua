import type { ConsoleEntry } from '../types/console';
import { useConsoleStore } from '../stores/consoleStore';
import { useResultStore } from '../stores/resultStore';
import { useGoLanguageStore } from '../stores/goLanguageStore';
import { useRustLanguageStore } from '../stores/rustLanguageStore';
import type { WorkspaceErrorBoundaryRegion } from '../components/Layout/WorkspaceErrorBoundary';

type ConsoleEntrySeed = Omit<ConsoleEntry, 'id' | 'timestamp'>;

interface LinguaE2eHooks {
  clearConsole: () => void;
  addConsoleEntries: (entries: ConsoleEntrySeed[]) => void;
  armWorkspaceCrash: (region: WorkspaceErrorBoundaryRegion) => void;
  showLspAdapterLoadFailure: (language: 'go' | 'rust') => void;
  /**
   * True once the Pyodide worker completed its init handshake. Passive: reads
   * the runner's boot flag without triggering a boot, so tests observing the
   * auto-run-boots-the-runtime contract still exercise the real trigger.
   */
  pythonRuntimeBooted: () => Promise<boolean>;
  /**
   * True once the in-flight auto-run has settled and published a result.
   *
   * Booting a runtime is not the same as finishing a run: the first
   * execution after a cold Pyodide boot still has to initialise the worker
   * and run the CPython auto-log pass, which on a loaded CI runner takes
   * far longer than a steady-state assertion window. Tests poll this
   * between the boot wait and their row assertions so a slow first run
   * reads as "still working" instead of "produced nothing".
   *
   * `clearVisibleResults()` nulls `executionTime` at the start of every
   * auto-run, before any runner work — so once a run is under way this can
   * never report a previous run's outcome. It says nothing about the
   * debounce window BEFORE that: between an edit and the run it schedules,
   * an earlier run's result is still published and this reads `true`. Poll
   * it only once something proves the run you care about has started, the
   * way the Python auto-log spec gates on the Pyodide boot first.
   */
  autoRunSettled: () => boolean;
}

let armedWorkspaceCrash: WorkspaceErrorBoundaryRegion | null = null;

export function shouldE2eWorkspaceCrash(region: WorkspaceErrorBoundaryRegion): boolean {
  return armedWorkspaceCrash === region;
}

export function clearE2eWorkspaceCrash(region: WorkspaceErrorBoundaryRegion): void {
  if (armedWorkspaceCrash === region) armedWorkspaceCrash = null;
}

declare global {
  interface Window {
    __linguaE2e?: LinguaE2eHooks;
  }
}

/**
 * Test-only hooks used by Playwright visual smoke specs. The installer is
 * guarded by a build-time define so production bundles tree-shake the bridge.
 */
export function installE2eHooks(): void {
  if (!__LINGUA_E2E_HOOKS__) return;

  window.__linguaE2e = {
    clearConsole: () => {
      useConsoleStore.getState().clear();
    },
    addConsoleEntries: entries => {
      useConsoleStore.getState().addEntries(entries);
    },
    armWorkspaceCrash: region => {
      armedWorkspaceCrash = region;
    },
    showLspAdapterLoadFailure: language => {
      const store = language === 'go' ? useGoLanguageStore : useRustLanguageStore;
      store.getState().setStatus({
        kind: 'degraded',
        reason: 'adapter-load-failed',
      });
    },
    pythonRuntimeBooted: async () => {
      // Dynamic imports: this module is on the startup path (web/main.tsx),
      // and static runner imports would drag the whole runner graph into the
      // eager bundle — tests/build/monacoInitialGraph.test.ts and
      // tests/scripts/activationMetrics.test.ts gate exactly that. By the
      // time a test polls this hook the app has loaded these modules anyway,
      // so the import() resolves from the module registry.
      const [{ runnerManager }, { PythonRunner }] = await Promise.all([
        import('../runners/manager'),
        import('../runners/python'),
      ]);
      // getRunner only instantiates the runner object (its init() is a flag
      // set) — Pyodide itself boots lazily on first execution, so this stays
      // a read, never a trigger.
      const runner = await runnerManager.getRunner('python');
      return runner instanceof PythonRunner && runner.isPyodideBooted();
    },
    autoRunSettled: () => {
      // Static import, unlike the runner hook above: resultStore is already
      // statically imported by CodeEditor and friends, so a dynamic import
      // here moves nothing into another chunk and rolldown warns about it
      // (INEFFECTIVE_DYNAMIC_IMPORT). The runner graph is the thing that has
      // to stay lazy, not the store.
      const { isAutoRunning, executionTime, error } = useResultStore.getState();
      if (isAutoRunning) return false;
      // A run that failed hard never publishes a duration, so accept an
      // error as a settled outcome too — the assertions that follow are
      // what decide whether it is the RIGHT outcome.
      return executionTime !== null || error !== null;
    },
  };
}
