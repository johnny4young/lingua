import { BookCopy, GitBranch, Info, ShieldCheck, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppInfo } from '../../hooks/useAppInfo';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUpdateStore } from '../../stores/updateStore';
import { Row, Section, Toggle } from './shared';

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
    <Section
      id="settings-about"
      title={t('about.title')}
      description={t('about.description')}
    >
      <div className="rounded-[1.2rem] border border-border/80 bg-background-elevated/72 p-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-[0_14px_35px_rgba(98,71,190,0.25)]">
            LG
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-xl font-semibold tracking-[-0.04em] text-foreground">
              {productName}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted">
              {t('about.hero.copy')}
            </p>
          </div>
        </div>
      </div>

      <Row label={t('about.field.version')} hint={t('about.field.versionHint')}>
        <span className="status-pill">{version}</span>
      </Row>

      <Row label={t('about.field.buildDate')} hint={t('about.field.buildDateHint')}>
        <span className="text-sm text-foreground">{buildDate}</span>
      </Row>

      <Row label={t('about.field.license')} hint={t('about.field.licenseHint')}>
        <span className="text-sm text-foreground">{licenseType}</span>
      </Row>

      <Row label={t('about.links.label')} hint={t('about.links.hint')}>
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
      </Row>

      <Row label={t('about.actions.label')} hint={t('about.actions.hint')}>
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
      </Row>

      <Row
        label={t('about.actions.showTourOnStartup.label')}
        hint={t('about.actions.showTourOnStartup.hint')}
      >
        <div className="flex justify-end">
          <div data-testid="settings-show-tour-toggle">
            <Toggle
              value={!suppressTourAutoStart}
              onChange={() => setSuppressTourAutoStart(!suppressTourAutoStart)}
            />
          </div>
        </div>
      </Row>
    </Section>
  );
}
