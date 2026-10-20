import { useTranslation } from 'react-i18next';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { executionModeForLanguage } from '../../utils/languageMeta';

/**
 * Validation and view-only tabs have no console stream worth reading, so
 * their report sits above the Console rows. Run output already streams there.
 */
export function DockOutputReport() {
  const { t } = useTranslation();
  const language = useEditorStore(state => getActiveTab(state)?.language);
  const fullOutput = useResultStore(state => state.fullOutput);
  const mode = language ? executionModeForLanguage(language) : 'run';
  if ((mode !== 'validate' && mode !== 'view') || fullOutput.length === 0) return null;

  return (
    <section
      data-testid="dock-output-report"
      aria-label={t(mode === 'validate' ? 'results.validation.title' : 'results.view.title')}
      className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border-subtle px-4 py-3"
    >
      <p className="text-eyebrow font-semibold uppercase tracking-[0.16em] text-fg-subtle">
        {t(mode === 'validate' ? 'results.validation.title' : 'results.view.title')}
      </p>
      <pre className="mt-1.5 whitespace-pre-wrap font-mono text-body-sm text-fg-base">
        {fullOutput}
      </pre>
    </section>
  );
}
