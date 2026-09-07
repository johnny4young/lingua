import type { ConsoleEntry } from '../types/console';
import { useConsoleStore } from '../stores/consoleStore';
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
  };
}
