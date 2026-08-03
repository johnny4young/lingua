/** Playwright-only wrapper that mounts the real Settings MCP surface. */

import { SettingsModal } from '../components/Settings/SettingsModal';

export function LocalMcpE2eFixture() {
  return (
    <main className="fixed inset-0 bg-background">
      <SettingsModal
        onClose={() => undefined}
        onOpenWhatsNew={() => undefined}
        onStartGuidedTour={() => undefined}
      />
    </main>
  );
}
