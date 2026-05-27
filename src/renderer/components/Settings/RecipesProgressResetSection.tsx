/**
 * RL-039 Slice B fold F — Settings → General → Reset recipe progress.
 *
 * Single button: clears the persisted `useLessonProgressStore`
 * entries after a `window.confirm()`. The OnboardingSection sits
 * next to this block as the canonical reference for the same
 * pattern (reset, push localized notice, surface i18n copy). Pure
 * renderer; nothing crosses IPC.
 */

import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { useLessonProgressStore } from '../../stores/lessonProgressStore';
import { useUIStore } from '../../stores/uiStore';
import { Section } from './shared';

export function RecipesProgressResetSection() {
  const { t } = useTranslation();
  const passedCount = useLessonProgressStore((s) => s.passedCount());
  const touchedCount = useLessonProgressStore((s) => s.touchedCount());
  const resetAll = useLessonProgressStore((s) => s.resetAll);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  const handleReset = () => {
    const confirmed =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(t('settings.recipes.resetConfirm'))
        : true;
    if (!confirmed) return;
    resetAll();
    pushStatusNotice({
      tone: 'info',
      messageKey: 'settings.recipes.resetNotice',
    });
  };

  return (
    <Section
      id="general-recipes-progress"
      title={t('settings.recipes.resetTitle')}
      description={t('settings.recipes.resetDescription')}
    >
      <div className="flex items-center justify-between gap-3 rounded-[1.15rem] border border-border/80 bg-background-elevated/72 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <GraduationCap size={13} aria-hidden="true" />
            {t('settings.recipes.resetTitle')}
          </p>
          <p
            className="mt-0.5 text-xs text-muted"
            data-testid="settings-recipes-counts"
          >
            {t('settings.recipes.resetDescription')}
            {' · '}
            <span data-testid="settings-recipes-passed-count">{passedCount}</span>
            {' / '}
            <span data-testid="settings-recipes-touched-count">{touchedCount}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={touchedCount === 0}
          data-testid="settings-recipes-reset"
          className="inline-flex h-7 items-center rounded border border-border/60 bg-surface/40 px-3 text-[11px] font-medium text-muted hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('settings.recipes.resetButton')}
        </button>
      </div>
    </Section>
  );
}
