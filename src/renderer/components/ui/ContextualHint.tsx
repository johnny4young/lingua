import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { selectContextualHint, type HintSurface } from '../../data/hints';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../utils/cn';

export function ContextualHint({
  surface,
  className,
}: {
  surface: HintSurface;
  className?: string;
}) {
  const { t } = useTranslation();
  const hintsEnabled = useSettingsStore(state => state.hintsEnabled);
  const setHintsEnabled = useSettingsStore(state => state.setHintsEnabled);
  const hint = selectContextualHint(surface);

  if (!hintsEnabled || !hint) return null;

  return (
    <div
      data-testid={`contextual-hint-${surface}`}
      className={cn(
        'flex max-w-xl items-start gap-2.5 rounded-lg border border-accent/20 bg-primary-soft/55 px-3 py-2.5 text-left font-sans',
        className
      )}
    >
      <Lightbulb size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-eyebrow font-semibold uppercase tracking-[0.14em] text-accent">
          {t('hints.label')}
        </p>
        <p className="mt-0.5 text-caption leading-[1.45] text-fg-muted">
          {t(hint.i18nKey)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setHintsEnabled(false)}
        className="shrink-0 rounded px-1.5 py-1 text-caption text-fg-subtle underline-offset-2 hover:text-fg-base hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        {t('hints.disable')}
      </button>
    </div>
  );
}
