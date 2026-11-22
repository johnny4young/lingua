import '../../i18n/appearanceCatalog';
import { Monitor, MoonStar, SunMedium } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_THEME_PACK_ID,
  THEME_PACKS,
  themePackAppearanceMatchesSettings,
  findThemePack,
  isFreeThemePack,
} from '../../data/themePacks';
import { resolveEffectiveShellTheme } from '../../hooks/useAppTheme';
import { identityPaletteFor } from '../../utils/editorThemeCatalog';
import { useEffectiveTier, useEntitlement } from '../../hooks/useEntitlement';
import { useSettingsStore } from '../../stores/settingsStore';
import { changeAppLanguage } from '../../i18n';
import type { AppLanguage } from '../../types/language';
import type { SettingsState } from '../../types/settings';
import { trackEvent } from '../../utils/telemetry';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { SettingsSection, SpecCard, SpecRow } from '../ui/SpecRow';
import { Select } from './shared';

const APP_THEMES = [
  {
    id: 'dark' as const,
    labelKey: 'appearance.theme.dark.label',
    icon: MoonStar,
  },
  {
    id: 'light' as const,
    labelKey: 'appearance.theme.light.label',
    icon: SunMedium,
  },
  {
    id: 'system' as const,
    labelKey: 'appearance.theme.system.label',
    icon: Monitor,
  },
];

const CUSTOM_PACK_VALUE = 'custom';

/**
 * The pack Settings names. The default id doubles as the marker manual edits
 * fall back to, so it names the Classic pack only while every field matches it.
 */
function activeThemePackId(settings: SettingsState): string | null {
  const pack = findThemePack(settings.themePack);
  if (!pack) return null;
  if (pack.id === DEFAULT_THEME_PACK_ID && !themePackAppearanceMatchesSettings(settings, pack.appearance)) {
    return null;
  }
  return pack.id;
}

/** Shell and editor swatch drawn with that theme's own tokens, not the current theme's. */
function ThemeSwatch({
  polarity,
  identity,
}: {
  readonly polarity: 'dark' | 'light';
  readonly identity: boolean;
}) {
  return (
    <span
      data-theme-swatch={polarity}
      data-palette={identity ? (polarity === 'dark' ? 'ink' : 'paper') : undefined}
      className={`${polarity} flex h-[26px] flex-1 overflow-hidden rounded-md border border-border-subtle`}
    >
      <span className="w-[28%] shrink-0 bg-bg-panel-alt" />
      <span className="flex flex-1 items-center gap-1 bg-[var(--color-editor-bg)] px-2">
        <span className="h-1.5 w-5 rounded-full bg-[var(--color-syntax-keyword)]" />
        <span className="h-1.5 w-8 rounded-full bg-[var(--color-syntax-string)]" />
        <span className="h-1.5 w-3 rounded-full bg-[var(--color-syntax-number)]" />
      </span>
    </span>
  );
}

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
  const activePackId = useSettingsStore(activeThemePackId);
  const applyThemePack = useSettingsStore((state) => state.applyThemePack);
  const { t } = useTranslation();
  const activePack = activePackId ? findThemePack(activePackId) : undefined;
  const effectiveTheme = resolveEffectiveShellTheme(theme, editorTheme);
  const identity = identityPaletteFor(editorTheme) !== null;

  const handleLanguageChange = (value: string) => {
    if (!isAppLanguage(value)) return;
    setLanguage(value);
    void changeAppLanguage(value, () => window.lingua.getSystemLanguages());
  };

  const handleThemePackChange = (packId: string) => {
    const isExtendedPack = !isFreeThemePack(packId);
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
    <SettingsSection eyebrow={t('appearance.title')}>
      {/*
       * The two field Selects (theme pack + language)
       * are read-only-shaped metadata rows grouped into ONE SpecCard.
       * The bespoke theme tile grid below stays a custom selectable card
       * cluster (proto keeps it custom), so it is NOT a SpecRow.
       */}
      <SpecCard>
        <SpecRow
          searchTargetId="appearance-theme-pack"
          label={t('settings.themePack.label')}
          strong
          description={activePack ? t(activePack.descriptionKey) : undefined}
          control={
            <Select
              value={activePack?.id ?? CUSTOM_PACK_VALUE}
              onChange={(event) => handleThemePackChange(event.currentTarget.value)}
              data-testid="theme-pack-select"
            >
              {activePack ? null : (
                <option value={CUSTOM_PACK_VALUE} disabled>
                  {t('settings.themePack.custom.label')}
                </option>
              )}
              {THEME_PACKS.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {isFreeThemePack(pack.id) || canUseExtendedThemePacks
                    ? t(pack.labelKey)
                    : `${t(pack.labelKey)} · ${t('license.badge.pro')}`}
                </option>
              ))}
            </Select>
          }
        />
        <SpecRow
          searchTargetId="appearance-language"
          label={t('language.label')}
          strong
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

      <div className="grid gap-3 sm:grid-cols-3">
        {APP_THEMES.map((option) => {
          const Icon = option.icon;
          const selected =
            theme === 'system' ? option.id === 'system' : effectiveTheme === option.id;

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
              <div className="mt-3 flex gap-2">
                {option.id === 'system' ? (
                  <>
                    <ThemeSwatch polarity="light" identity={identity} />
                    <ThemeSwatch polarity="dark" identity={identity} />
                  </>
                ) : (
                  <ThemeSwatch polarity={option.id} identity={identity} />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}
