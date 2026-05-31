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
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';

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

  const label = (
    <span className="flex items-center gap-1.5">
      <GraduationCap size={13} aria-hidden="true" />
      {t('settings.recipes.resetTitle')}
    </span>
  );

  const description = (
    <span data-testid="settings-recipes-counts">
      {t('settings.recipes.resetDescription')}
      {' · '}
      <span data-testid="settings-recipes-passed-count">{passedCount}</span>
      {' / '}
      <span data-testid="settings-recipes-touched-count">{touchedCount}</span>
    </span>
  );

  return (
    <SettingsSection
      eyebrow={t('settings.recipes.resetTitle')}
      description={t('settings.recipes.resetDescription')}
    >
      <SpecCard>
        <SpecRow
          label={label}
          description={description}
          control={
            <button
              type="button"
              onClick={handleReset}
              disabled={touchedCount === 0}
              data-testid="settings-recipes-reset"
              className="button-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('settings.recipes.resetButton')}
            </button>
          }
          last
        />
      </SpecCard>
    </SettingsSection>
  );
}
