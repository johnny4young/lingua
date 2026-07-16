import type { ConsoleEntry } from '../types';
import { useConsoleStore } from '../stores/consoleStore';
import type { WorkspaceErrorBoundaryRegion } from '../components/Layout/WorkspaceErrorBoundary';

type ConsoleEntrySeed = Omit<ConsoleEntry, 'id' | 'timestamp'>;

interface LinguaE2eHooks {
  clearConsole: () => void;
  addConsoleEntries: (entries: ConsoleEntrySeed[]) => void;
  armWorkspaceCrash: (region: WorkspaceErrorBoundaryRegion) => void;
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
      const { addEntry } = useConsoleStore.getState();
      for (const entry of entries) {
        addEntry(entry);
      }
    },
    armWorkspaceCrash: region => {
      armedWorkspaceCrash = region;
    },
  };
}
