import { MoonStar, SunMedium } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_THEME_PACK_ID, THEME_PACKS } from '../../data/themePacks';
import { resolveEffectiveShellTheme } from '../../hooks/useAppTheme';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useSettingsStore } from '../../stores/settingsStore';
import { changeAppLanguage } from '../../i18n';
import type { AppLanguage } from '../../types';
import { trackEvent } from '../../utils/telemetry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { Select } from './shared';

const APP_THEMES = [
  {
    id: 'dark' as const,
    labelKey: 'appearance.theme.dark.label',
    descriptionKey: 'appearance.theme.dark.description',
    icon: MoonStar,
  },
  {
    id: 'light' as const,
    labelKey: 'appearance.theme.light.label',
    descriptionKey: 'appearance.theme.light.description',
    icon: SunMedium,
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
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const themePack = useSettingsStore((state) => state.themePack);
  const applyThemePack = useSettingsStore((state) => state.applyThemePack);
  const { t } = useTranslation();
  const activePack = THEME_PACKS.find((pack) => pack.id === themePack) ?? THEME_PACKS[0]!;
  const effectiveTheme = resolveEffectiveShellTheme(theme, editorTheme);

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
    <SettingsSection eyebrow={t('appearance.title')} description={t('appearance.description')}>
      {/*
       * MOV.04 rhythm — the two field Selects (theme pack + language)
       * are read-only-shaped metadata rows grouped into ONE SpecCard.
       * The bespoke theme tile grid below stays a custom selectable card
       * cluster (proto keeps it custom), so it is NOT a SpecRow.
       */}
      <SpecCard>
        <SpecRow
          label={t('settings.themePack.label')}
          description={t(activePack.descriptionKey)}
          control={
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
          }
        />
        <SpecRow
          label={t('language.label')}
          description={t('language.hint')}
          last
          control={
            <Select
              value={language}
              onChange={(e) => handleLanguageChange(e.currentTarget.value)}
              data-testid="app-language-select"
            >
              <option value="system">{t('language.system')}</option>
              <option value="en">{t('language.en')}</option>
              <option value="es">{t('language.es')}</option>
            </Select>
          }
        />
      </SpecCard>

      <div className="grid gap-3 sm:grid-cols-2">
        {APP_THEMES.map((option) => {
          const Icon = option.icon;
          const selected = effectiveTheme === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              aria-pressed={selected}
              className={`rounded-lg border p-4 text-left transition-all ${
                selected
                  ? 'border-accent bg-primary-soft'
                  : 'border-border-subtle bg-bg-inset hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-lg font-semibold text-fg-base">
                  {t(option.labelKey)}
                </span>
                <span className={selected ? 'text-accent' : 'text-fg-subtle'}>
                  <Icon size={16} />
                </span>
              </div>
              <p className="mt-1.5 text-body-sm leading-5 text-fg-subtle">
                {t(option.descriptionKey)}
              </p>
              <div className="mt-3 flex gap-2">
                <span className="h-[26px] w-[70px] shrink-0 rounded-md bg-bg-panel-alt" />
                <span className="h-[26px] flex-1 rounded-md bg-bg-panel" />
              </div>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}
