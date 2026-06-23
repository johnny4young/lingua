import { BookCopy, GitBranch, Info, ShieldCheck, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppInfo } from '../../hooks/useAppInfo';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUpdateStore } from '../../stores/updateStore';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { Toggle } from './shared';
import { ProfileSection } from './ProfileSection';

function formatBuildDate(value: string | null, locale: string, unavailable: string): string {
  if (!value) {
    return unavailable;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return unavailable;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function ExternalLinkButton({
  label,
  href,
  icon,
}: {
  label: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => void window.lingua.openExternal(href)}
      className="button-secondary"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function AboutSection({
  onOpenWhatsNew,
  onStartGuidedTour,
}: {
  onOpenWhatsNew?: () => void;
  onStartGuidedTour?: () => void;
}) {
  const appInfo = useAppInfo();
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const updateStatus = useUpdateStore((state) => state.status);
  const suppressTourAutoStart = useSettingsStore(
    (state) => state.suppressTourAutoStart
  );
  const setSuppressTourAutoStart = useSettingsStore(
    (state) => state.setSuppressTourAutoStart
  );
  const { t, i18n } = useTranslation();

  const productName = appInfo?.productName ?? 'Lingua';
  const version = appInfo?.version ?? t('about.value.loading');
  const buildDate = formatBuildDate(
    appInfo?.buildDate ?? null,
    i18n.language,
    t('about.value.unavailable')
  );
  const licenseType = appInfo?.licenseType ?? t('about.value.loading');

  return (
    <div className="space-y-7">
      <SettingsSection eyebrow={t('about.title')} description={t('about.description')}>
        {/* Hero identity tile — LG glyph + product name, above the spec card. */}
        <div className="flex items-start gap-3 rounded-lg border border-border-subtle bg-bg-inset p-4">
          <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-4xl bg-primary text-body font-semibold text-primary-foreground shadow-[0_14px_35px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]">
            LG
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-h2 font-semibold tracking-[-0.04em] text-fg-base">
              {productName}
            </p>
            <p className="mt-1 text-body leading-6 text-fg-subtle">
              {t('about.hero.copy')}
            </p>
          </div>
        </div>

        {/* Read-only metadata — one spec card, three divided rows, quiet
            font-mono values (plain data, not states → no StatusBadge). */}
        <SpecCard>
          <SpecRow
            label={t('about.field.version')}
            control={
              <span className="font-mono text-body-sm text-fg-base">{version}</span>
            }
          />
          <SpecRow
            label={t('about.field.buildDate')}
            control={
              <span className="font-mono text-body-sm text-fg-base">{buildDate}</span>
            }
          />
          <SpecRow
            label={t('about.field.license')}
            control={
              <span className="font-mono text-body-sm text-fg-base">{licenseType}</span>
            }
            last
          />
        </SpecCard>
      </SettingsSection>

      <SettingsSection eyebrow={t('about.links.label')} description={t('about.links.hint')}>
        <SpecCard>
          <SpecRow
            label={t('about.links.label')}
            description={t('about.links.hint')}
            control={
              <div className="flex flex-wrap justify-end gap-2">
                {appInfo?.repositoryUrl && (
                  <ExternalLinkButton
                    label={t('about.links.github')}
                    href={appInfo.repositoryUrl}
                    icon={<GitBranch size={14} />}
                  />
                )}
                {appInfo?.websiteUrl && (
                  <ExternalLinkButton
                    label={t('about.links.website')}
                    href={appInfo.websiteUrl}
                    icon={<Sparkles size={14} />}
                  />
                )}
                {appInfo?.licenseUrl && (
                  <ExternalLinkButton
                    label={t('about.links.license')}
                    href={appInfo.licenseUrl}
                    icon={<ShieldCheck size={14} />}
                  />
                )}
              </div>
            }
          />
          <SpecRow
            label={t('about.actions.label')}
            description={t('about.actions.hint')}
            control={
              <div className="flex flex-wrap justify-end gap-2">
                {onStartGuidedTour && (
                  <button
                    type="button"
                    onClick={onStartGuidedTour}
                    data-testid="about-start-tour"
                    className="button-secondary"
                  >
                    <BookCopy size={14} />
                    <span>{t('about.actions.startTour')}</span>
                  </button>
                )}
                {onOpenWhatsNew && (
                  <button
                    type="button"
                    onClick={onOpenWhatsNew}
                    className="button-secondary"
                  >
                    <Sparkles size={14} />
                    <span>{t('about.actions.whatsNew')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void checkForUpdates()}
                  disabled={updateStatus === 'checking'}
                  className="button-primary"
                >
                  <Info size={14} />
                  <span>
                    {updateStatus === 'checking'
                      ? t('updates.actions.checking')
                      : t('about.actions.checkUpdates')}
                  </span>
                </button>
              </div>
            }
          />
          <SpecRow
            label={t('about.actions.showTourOnStartup.label')}
            description={t('about.actions.showTourOnStartup.hint')}
            control={
              <div data-testid="settings-show-tour-toggle">
                <Toggle
                  value={!suppressTourAutoStart}
                  onChange={() => setSuppressTourAutoStart(!suppressTourAutoStart)}
                  aria-label={t('about.actions.showTourOnStartup.label')}
                />
              </div>
            }
            last
          />
        </SpecCard>
      </SettingsSection>

      <ProfileSection />
    </div>
  );
}
