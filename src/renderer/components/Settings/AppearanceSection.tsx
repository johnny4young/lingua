import { MoonStar, SunMedium } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_THEME_PACK_ID, THEME_PACKS } from '../../data/themePacks';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useSettingsStore } from '../../stores/settingsStore';
import { changeAppLanguage } from '../../i18n';
import type { AppLanguage } from '../../types';
import { trackEvent } from '../../utils/telemetry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { Row, Section, Select } from './shared';

const APP_THEMES = [
  {
    id: 'dark' as const,
    labelKey: 'appearance.theme.dark.label',
    descriptionKey: 'appearance.theme.dark.description',
    icon: MoonStar,
    previewClass: 'from-[#10141c] via-[#1b2130] to-[#11161f]',
  },
  {
    id: 'light' as const,
    labelKey: 'appearance.theme.light.label',
    descriptionKey: 'appearance.theme.light.description',
    icon: SunMedium,
    previewClass: 'from-[#f6f1e9] via-[#fbf7f1] to-[#ece5da]',
  },
];

const VALID_LANGUAGES: readonly AppLanguage[] = ['system', 'en', 'es'];

function isAppLanguage(value: string): value is AppLanguage {
  return (VALID_LANGUAGES as readonly string[]).includes(value);
}

export function AppearanceSection() {
  const effectiveTier = useEffectiveTier();
  const canUseExtendedThemePacks = useEntitlement('THEME_PACK_EXTENDED');
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const themePack = useSettingsStore((state) => state.themePack);
  const applyThemePack = useSettingsStore((state) => state.applyThemePack);
  const { t } = useTranslation();
  const activePack = THEME_PACKS.find((pack) => pack.id === themePack) ?? THEME_PACKS[0]!;

  const handleLanguageChange = (value: string) => {
    if (!isAppLanguage(value)) return;
    setLanguage(value);
    void changeAppLanguage(value, () => window.lingua.getSystemLanguages());
  };

  const handleThemePackChange = (packId: string) => {
    const isExtendedPack = packId !== DEFAULT_THEME_PACK_ID;
    if (isExtendedPack && !canUseExtendedThemePacks) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: t('upsell.feature.themePacks'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'theme-packs',
        tier: effectiveTier,
      });
      return;
    }
    applyThemePack(packId);
  };

  return (
    <Section
      title={t('appearance.title')}
      description={t('appearance.description')}
    >
      <Row
        label={t('settings.themePack.label')}
        hint={t(activePack.descriptionKey)}
      >
        <Select
          value={themePack}
          onChange={(event) => handleThemePackChange(event.currentTarget.value)}
          data-testid="theme-pack-select"
        >
          {THEME_PACKS.map((pack) => (
            <option key={pack.id} value={pack.id}>
              {pack.id === DEFAULT_THEME_PACK_ID || canUseExtendedThemePacks
                ? t(pack.labelKey)
                : `${t(pack.labelKey)} · ${t('license.badge.pro')}`}
            </option>
          ))}
        </Select>
      </Row>

      <div className="grid gap-3 sm:grid-cols-2">
        {APP_THEMES.map((option) => {
          const Icon = option.icon;
          const selected = theme === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              className={`rounded-[1.2rem] border p-3.5 text-left transition-all ${
                selected
                  ? 'border-primary/35 bg-primary-soft shadow-[0_16px_55px_rgba(77,54,156,0.16)]'
                  : 'border-border/80 bg-background-elevated/72 hover:border-border-strong/90 hover:bg-surface/88'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold tracking-[-0.03em] text-foreground">
                    {t(option.labelKey)}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-5 text-muted">
                    {t(option.descriptionKey)}
                  </p>
                </div>
                <div
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                    selected ? 'bg-primary text-primary-foreground' : 'bg-surface-strong text-muted'
                  }`}
                >
                  <Icon size={16} />
                </div>
              </div>

              <div
                className={`mt-3 h-16 rounded-[1rem] border border-white/6 bg-gradient-to-br ${option.previewClass} p-2.5`}
              >
                <div className="flex h-full gap-2">
                  <div className="w-[28%] rounded-[0.9rem] border border-white/10 bg-black/10" />
                  <div className="flex-1 rounded-[0.9rem] border border-white/10 bg-black/6" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Row label={t('language.label')} hint={t('language.hint')}>
        <Select
          value={language}
          onChange={(e) => handleLanguageChange(e.currentTarget.value)}
          data-testid="app-language-select"
        >
          <option value="system">{t('language.system')}</option>
          <option value="en">{t('language.en')}</option>
          <option value="es">{t('language.es')}</option>
        </Select>
      </Row>
    </Section>
  );
}
