import { identityPaletteFor, type IdentityPalette } from './editorThemeCatalog';

/** The polarity actually applied to the shell. */
export type AppTheme = 'dark' | 'light';
export const APP_THEME_COLOR: Record<AppTheme, string> = {
  dark: '#0c1017',
  light: '#f4efe7',
};
const PALETTE_THEME_COLOR: Record<IdentityPalette, string> = {
  ink: '#05090a',
  paper: '#ffffff',
};

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The Lingua editor theme for a polarity, staying in Ink/Paper when the current theme is one of them. */
export function linguaEditorTheme(polarity: AppTheme, currentEditorTheme = ''): string {
  if (identityPaletteFor(currentEditorTheme)) {
    return polarity === 'dark' ? 'lingua-ink' : 'lingua-paper';
  }
  return polarity === 'dark' ? 'lingua-dark' : 'lingua-light';
}

/** The Lingua editor theme that matches the OS preference. */
export function systemEditorTheme(currentEditorTheme = ''): string {
  return linguaEditorTheme(systemPrefersDark() ? 'dark' : 'light', currentEditorTheme);
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

export function applyAppTheme(
  theme: AppTheme,
  doc: Document = document,
  palette: IdentityPalette | null = null
): void {
  const root = doc.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (palette) root.dataset.palette = palette;
  else delete root.dataset.palette;

  const themeColorMeta = ensureThemeColorMeta(doc);
  themeColorMeta.setAttribute('content', palette ? PALETTE_THEME_COLOR[palette] : APP_THEME_COLOR[theme]);
}
