import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import {
  SEEDED_SCRATCHPAD_LANGUAGE,
  SEEDED_SCRATCHPAD_NAME,
  SEEDED_SCRATCHPAD_SOURCE,
} from '../../onboarding/seedScratchpad';
import { Row, Section, Toggle } from './shared';

/**
 * RL-101 Slice 1 — Settings → General → Onboarding section.
 *
 * Three "reset" toggles. Each toggle's visible state mirrors the
 * persisted flag's value: when the user has already seen a stage
 * (flag = `true`) the corresponding toggle reads as **ON** (the
 * stage has been completed). Flipping the toggle off calls the
 * `reset…` setter on the store which flips the flag back to `false`
 * so the next eligible event re-fires the toast. Flipping it back on
 * is a no-op (you can't pretend you've seen something you haven't).
 *
 * Fold F — collapsible read-only preview of the welcome scratchpad
 * source so power users can audit what gets auto-injected without
 * triggering the seed by mistake.
 */
export function OnboardingSection() {
  const { t } = useTranslation();
  const hasCompletedOnboardingWelcome = useSettingsStore(
    (state) => state.hasCompletedOnboardingWelcome
  );
  const hasCompletedOnboardingFirstRun = useSettingsStore(
    (state) => state.hasCompletedOnboardingFirstRun
  );
  const hasCompletedOnboardingFirstSnippet = useSettingsStore(
    (state) => state.hasCompletedOnboardingFirstSnippet
  );
  const resetOnboardingWelcome = useSettingsStore(
    (state) => state.resetOnboardingWelcome
  );
  const resetOnboardingFirstRun = useSettingsStore(
    (state) => state.resetOnboardingFirstRun
  );
  const resetOnboardingFirstSnippet = useSettingsStore(
    (state) => state.resetOnboardingFirstSnippet
  );
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);
  const [previewOpen, setPreviewOpen] = useState(false);

  const flipWelcome = () => {
    if (!hasCompletedOnboardingWelcome) return;
    resetOnboardingWelcome();
    pushStatusNotice({
      tone: 'info',
      messageKey: 'onboarding.notice.welcomeReplay',
    });
  };
  const flipFirstRun = () => {
    if (!hasCompletedOnboardingFirstRun) return;
    resetOnboardingFirstRun();
  };
  const flipFirstSnippet = () => {
    if (!hasCompletedOnboardingFirstSnippet) return;
    resetOnboardingFirstSnippet();
  };

  return (
    <Section
      id="general-onboarding"
      title={t('onboarding.section.title')}
      description={t('onboarding.section.hint')}
    >
      <Row
        label={t('onboarding.reset.welcome.label')}
        hint={t('onboarding.reset.welcome.hint')}
      >
        <Toggle
          value={hasCompletedOnboardingWelcome}
          onChange={flipWelcome}
          aria-label={t('onboarding.reset.welcome.label')}
        />
      </Row>
      <Row
        label={t('onboarding.reset.firstRun.label')}
        hint={t('onboarding.reset.firstRun.hint')}
      >
        <Toggle
          value={hasCompletedOnboardingFirstRun}
          onChange={flipFirstRun}
          aria-label={t('onboarding.reset.firstRun.label')}
        />
      </Row>
      <Row
        label={t('onboarding.reset.firstSnippet.label')}
        hint={t('onboarding.reset.firstSnippet.hint')}
      >
        <Toggle
          value={hasCompletedOnboardingFirstSnippet}
          onChange={flipFirstSnippet}
          aria-label={t('onboarding.reset.firstSnippet.label')}
        />
      </Row>
      <div className="rounded-[1.15rem] border border-border/80 bg-background-elevated/72 px-3.5 py-3">
        <button
          type="button"
          onClick={() => setPreviewOpen((open) => !open)}
          aria-expanded={previewOpen}
          aria-controls="onboarding-seed-preview"
          data-testid="onboarding-section-preview-toggle"
          className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-foreground"
        >
          <span>{t('onboarding.section.previewLabel')}</span>
          {previewOpen ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
        </button>
        {previewOpen ? (
          <div
            id="onboarding-seed-preview"
            className="mt-3 space-y-2"
            data-testid="onboarding-section-preview-body"
          >
            <p className="text-xs text-muted font-mono">
              {SEEDED_SCRATCHPAD_NAME} · {SEEDED_SCRATCHPAD_LANGUAGE}
            </p>
            <pre
              data-testid="onboarding-section-preview-source"
              className="max-h-[40vh] overflow-auto rounded-md border border-border/70 bg-bg-elevated/80 p-3 text-[11px] leading-snug text-fg-base whitespace-pre-wrap break-words"
            >
              {SEEDED_SCRATCHPAD_SOURCE}
            </pre>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
