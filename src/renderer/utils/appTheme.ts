/** The polarity actually applied to the shell. */
export type AppTheme = 'dark' | 'light';
export const APP_THEME_COLOR: Record<AppTheme, string> = {
  dark: '#0c1017',
  light: '#f4efe7',
};

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The Lingua editor theme that matches the OS preference. */
export function systemEditorTheme(): 'lingua-dark' | 'lingua-light' {
  return systemPrefersDark() ? 'lingua-dark' : 'lingua-light';
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
