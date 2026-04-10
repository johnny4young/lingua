import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

const THEME_COLOR: Record<'dark' | 'light', string> = {
  dark: '#0c1017',
  light: '#f4efe7',
};

export function useAppTheme() {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    themeColorMeta?.setAttribute('content', THEME_COLOR[theme]);
  }, [theme]);
}
