/** Playwright-only deterministic evidence surface for the Tests dock tab. */

import { TestsPanel } from '../components/ProjectTests/TestsPanel';

export function ProjectTestsE2eFixture() {
  return (
    <div className="h-screen bg-bg-base p-6">
      <div className="h-[420px] overflow-hidden rounded-lg border border-border-subtle">
        <TestsPanel />
      </div>
    </div>
  );
}
