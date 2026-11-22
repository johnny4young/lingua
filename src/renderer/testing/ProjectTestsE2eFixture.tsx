/** Playwright-only deterministic evidence surface for the Tests dock tab. */

import { TestsDockControls } from '../components/ProjectTests/TestsDockControls';
import { TestsMeter } from '../components/ProjectTests/TestsMeter';
import { TestsPanel } from '../components/ProjectTests/TestsPanel';

export function ProjectTestsE2eFixture() {
  return (
    <div className="h-screen bg-bg-base p-6">
      <div className="dock-shell h-[420px] overflow-hidden rounded-lg border border-border-subtle bg-bg-panel">
        <div className="dock-shell-row">
          <TestsMeter />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-[34px] shrink-0 items-center justify-end border-b border-border-subtle px-2">
              <TestsDockControls />
            </div>
            <div className="min-h-0 flex-1">
              <TestsPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
