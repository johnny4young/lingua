import { ConsolePanel } from '../components/Console/ConsolePanel';
import { StatusNoticeBanner } from '../components/StatusNotice/StatusNoticeBanner';
import { useAppTheme } from '../hooks/useAppTheme';
import { useDefaultOpenFileConsumer } from '../hooks/useDefaultOpenFileConsumer';

/**
 * Playwright-only fixture for internal visual smoke. The normal workspace never
 * downloads this component because web/main dynamically imports it only when
 * both __LINGUA_E2E_HOOKS__ and the rich-console-gallery query are active.
 */
export function RichConsoleE2eFixture() {
  useAppTheme();
  useDefaultOpenFileConsumer();

  return (
    <>
      <main
        data-testid="rich-console-e2e-fixture"
        className="h-screen bg-bg-base p-4 text-foreground"
      >
        <section className="mx-auto h-full max-w-5xl overflow-hidden rounded-4xl border border-border-subtle/70 bg-bg-panel shadow-xl">
          <ConsolePanel />
        </section>
      </main>
      <StatusNoticeBanner />
    </>
  );
}
