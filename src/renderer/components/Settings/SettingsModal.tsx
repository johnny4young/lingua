import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { EditorSection } from './EditorSection';
import { EnvVarsSection } from './EnvVarsSection';
import { LayoutSection } from './LayoutSection';
import { LicenseSection } from './LicenseSection';
import { PluginsSection } from './PluginsSection';
import { PrivacySection } from './PrivacySection';
import { UpdatesSection } from './UpdatesSection';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';

interface SettingsModalProps {
  onClose: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
}

export function SettingsModal({
  onClose,
  onOpenWhatsNew,
  onStartGuidedTour,
}: SettingsModalProps) {
  const { t } = useTranslation();

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard className="relative w-[min(96vw,1480px)] max-w-none">
        <div className="surface-header flex items-start justify-between gap-4 px-5 py-4">
          <div>
            <p className="panel-title">{t('settings.title')}</p>
            <h2 className="mt-2 font-display text-[2rem] font-semibold tracking-[-0.04em] text-foreground">
              {t('settings.subtitle')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              {t('settings.description')}
            </p>
          </div>
          <IconButton onClick={onClose} tooltip={t('settings.close')}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="max-h-[78vh] overflow-y-auto px-5 py-4">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <AboutSection
                onOpenWhatsNew={onOpenWhatsNew}
                onStartGuidedTour={onStartGuidedTour}
              />
              <AppearanceSection />
              <LayoutSection />
              <UpdatesSection />
            </div>
            <div className="space-y-6">
              <EditorSection />
              <LicenseSection />
              <PrivacySection />
              <EnvVarsSection />
              <PluginsSection />
            </div>
          </div>
        </div>

        <div className="surface-header flex items-center justify-between px-5 py-3">
          <p className="text-xs text-muted">
            {t('settings.footer')}
          </p>
          <span className="status-pill">{t('settings.autosave')}</span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
