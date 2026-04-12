import type { SettingsState } from '../types';

export type AppTheme = SettingsState['theme'];

export const APP_THEME_STORAGE_KEY = 'lingua-settings';
export const DEFAULT_APP_THEME: AppTheme = 'dark';
export const APP_THEME_COLOR: Record<AppTheme, string> = {
  dark: '#0c1017',
  light: '#f4efe7',
};

function isThemeRecord(value: unknown): value is Partial<Pick<SettingsState, 'theme'>> {
  return typeof value === 'object' && value !== null && 'theme' in value;
}

export function isAppTheme(value: unknown): value is AppTheme {
  return value === 'dark' || value === 'light';
}

export function getStoredAppTheme(serializedState: string | null): AppTheme | null {
  if (!serializedState) {
    return null;
  }

  try {
    const parsed = JSON.parse(serializedState) as unknown;

    if (isThemeRecord(parsed) && isAppTheme(parsed.theme)) {
      return parsed.theme;
    }

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'state' in parsed &&
      isThemeRecord(parsed.state) &&
      isAppTheme(parsed.state.theme)
    ) {
      return parsed.state.theme;
    }
  } catch {
    return null;
  }

  return null;
}

export function ensureThemeColorMeta(doc: Document): HTMLMetaElement {
  const existingMeta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (existingMeta) {
    return existingMeta;
  }

  const createdMeta = doc.createElement('meta');
  createdMeta.name = 'theme-color';
  doc.head.appendChild(createdMeta);
  return createdMeta;
}

export function applyAppTheme(theme: AppTheme, doc: Document = document): void {
  const root = doc.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const themeColorMeta = ensureThemeColorMeta(doc);
  themeColorMeta.setAttribute('content', APP_THEME_COLOR[theme]);
}
