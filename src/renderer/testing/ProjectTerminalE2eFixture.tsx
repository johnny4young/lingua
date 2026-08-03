/** Playwright-only deterministic evidence surface for the project terminal. */

import { useTranslation } from 'react-i18next';
import { BottomPanel } from '../components/Layout/BottomPanel';

export function ProjectTerminalE2eFixture() {
  const { t } = useTranslation();
  return (
    <main className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background p-6">
      <header className="surface-panel mb-4 flex items-start justify-between gap-6 px-5 py-4">
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-[0.16em] text-primary">
            {t('e2e.desktop.brand')}
          </p>
          <h1 className="mt-1 font-display text-h2 font-semibold text-foreground">
            {t('projectTerminal.title', { project: 'polyglot-checkout' })}
          </h1>
          <p className="mt-2 max-w-3xl text-body text-muted">
            {t('projectTerminal.description')}
          </p>
        </div>
        <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-caption font-semibold text-success">
          {t('e2e.desktop.localFirst')}
        </span>
      </header>
      <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border-strong shadow-2xl">
        <BottomPanel debuggerAvailable={false} />
      </section>
    </main>
  );
}
