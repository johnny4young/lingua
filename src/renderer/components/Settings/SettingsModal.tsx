import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Settings as SettingsIcon,
  Palette,
  FileCode2,
  Terminal,
  KeyRound,
} from 'lucide-react';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { EditorSection } from './EditorSection';
import { EnvVarsSection } from './EnvVarsSection';
import { ExecutionHistorySection } from './ExecutionHistorySection';
import { LayoutSection } from './LayoutSection';
import { LicenseSection } from './LicenseSection';
import { PluginsSection } from './PluginsSection';
import { PrivacySection } from './PrivacySection';
import { RecoverySection } from './RecoverySection';
import { UpdatesSection } from './UpdatesSection';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { Eyebrow } from '../ui/primitives';
import { cn } from '../../utils/cn';

/**
 * RL-070 Sub-slice 2 — Tabbed Settings.
 *
 * The previous SettingsModal stacked 11 sections in a 2-column grid
 * that scrolled ~2000px. The Signal-Slate design groups these into
 * five lateral concerns the user can switch between with one click,
 * each tab keeping its own scroll inside a much smaller surface.
 *
 * Tab → section mapping:
 *
 *   General      → About, Updates
 *   Appearance   → Appearance, Layout
 *   Editor       → Editor, ExecutionHistory, Plugins
 *   Environment  → EnvVars
 *   Account      → License, Privacy
 *
 * The child sections (`AboutSection`, `EditorSection`, etc.) keep
 * their own internal layouts unchanged. This refactor only touches
 * the modal's outer structure.
 *
 * Keyboard nav: ←/→ rotate through tabs; Esc still closes the modal
 * (handled by `OverlayBackdrop`).
 */
type TabId = 'general' | 'appearance' | 'editor' | 'environment' | 'account';

interface SettingsModalProps {
  onClose: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
}

interface TabDef {
  id: TabId;
  labelKey: string;
  icon: typeof SettingsIcon;
}

const TABS: readonly TabDef[] = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: SettingsIcon },
  { id: 'appearance', labelKey: 'settings.tabs.appearance', icon: Palette },
  { id: 'editor', labelKey: 'settings.tabs.editor', icon: FileCode2 },
  { id: 'environment', labelKey: 'settings.tabs.environment', icon: Terminal },
  { id: 'account', labelKey: 'settings.tabs.account', icon: KeyRound },
];

export function SettingsModal({
  onClose,
  onOpenWhatsNew,
  onStartGuidedTour,
}: SettingsModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('general');

  const handleTabKeydown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target as HTMLElement | null;
      const tabButton = target?.closest('[role="tab"][id^="settings-tab-"]');
      if (!(tabButton instanceof HTMLButtonElement)) return;
      const idx = TABS.findIndex((tab) => tab.id === activeTab);
      if (idx === -1) return;
      const next =
        event.key === 'ArrowRight'
          ? TABS[(idx + 1) % TABS.length]
          : TABS[(idx - 1 + TABS.length) % TABS.length];
      if (next) {
        event.preventDefault();
        setActiveTab(next.id);
        window.requestAnimationFrame(() => {
          document.getElementById(`settings-tab-${next.id}`)?.focus();
        });
      }
    },
    [activeTab]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleTabKeydown);
    return () => window.removeEventListener('keydown', handleTabKeydown);
  }, [handleTabKeydown]);

  const renderTabContent = (): ReactNode => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6">
            <AboutSection
              onOpenWhatsNew={onOpenWhatsNew}
              onStartGuidedTour={onStartGuidedTour}
            />
            <UpdatesSection />
          </div>
        );
      case 'appearance':
        return (
          <div className="space-y-6">
            <AppearanceSection />
            <LayoutSection />
          </div>
        );
      case 'editor':
        return (
          <div className="space-y-6">
            <EditorSection />
            <ExecutionHistorySection />
            <PluginsSection />
          </div>
        );
      case 'environment':
        return (
          <div className="space-y-6">
            <EnvVarsSection />
          </div>
        );
      case 'account':
        return (
          <div className="space-y-6">
            <LicenseSection />
            <PrivacySection />
            <RecoverySection />
          </div>
        );
    }
  };

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="relative w-[min(96vw,1100px)] max-w-none"
      >
        {/* Header */}
        <div className="surface-header px-6 pt-5 pb-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Eyebrow>{t('settings.title')}</Eyebrow>
              <h2
                id="settings-modal-title"
                className="font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground"
              >
                {t('settings.subtitle')}
              </h2>
              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-[1.5] text-muted">
                {t('settings.description')}
              </p>
            </div>
            <IconButton onClick={onClose} tooltip={t('settings.close')}>
              <X size={16} />
            </IconButton>
          </div>

          {/* Tab bar */}
          <div
            role="tablist"
            aria-label={t('settings.tabs.ariaLabel')}
            className="mt-4 flex items-end gap-0 -mb-px"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  id={`settings-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`settings-tab-${tab.id}`}
                  className={cn(
                    'relative inline-flex items-center gap-1.5 px-3.5 py-2.5 text-[12.5px] font-medium tracking-[-0.005em] transition-colors',
                    isActive
                      ? 'border-b-2 border-primary text-foreground'
                      : 'border-b-2 border-transparent text-muted hover:text-foreground'
                  )}
                >
                  <Icon
                    size={12}
                    className={cn(isActive ? 'text-primary' : 'text-muted')}
                    aria-hidden="true"
                  />
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div
          id={`settings-panel-${activeTab}`}
          className="max-h-[68vh] overflow-y-auto px-6 py-5"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          key={activeTab}
        >
          {renderTabContent()}
        </div>

        {/* Footer */}
        <div className="surface-header flex items-center justify-between px-6 py-2.5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
            {t('settings.footer.trail', {
              section: t(`settings.tabs.${activeTab}`),
            })}
          </p>
          <span className="status-pill text-success">
            ● {t('settings.autosave')}
          </span>
        </div>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
