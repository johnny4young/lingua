import { ConsolePanel } from '../components/Console/ConsolePanel';
import { useAppTheme } from '../hooks/useAppTheme';

/**
 * Playwright-only fixture for RL-044 visual smoke. The production build never
 * reaches this component because web/main gates it behind __LINGUA_E2E_HOOKS__.
 */
export function RichConsoleE2eFixture() {
  useAppTheme();

  return (
    <main
      data-testid="rich-console-e2e-fixture"
      className="h-screen bg-bg-base p-4 text-foreground"
    >
      <section className="mx-auto h-full max-w-5xl overflow-hidden rounded-2xl border border-border-subtle/70 bg-bg-panel shadow-xl">
        <ConsolePanel />
      </section>
    </main>
  );
}
