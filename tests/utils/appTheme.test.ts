import { describe, expect, it } from 'vitest';
import {
  APP_THEME_COLOR,
  applyAppTheme,
  ensureThemeColorMeta,
  getStoredAppTheme,
} from '@/utils/appTheme';

describe('appTheme utilities', () => {
  it('reads the persisted app theme from zustand payloads', () => {
    expect(getStoredAppTheme(null)).toBeNull();
    expect(getStoredAppTheme('{"theme":"light"}')).toBe('light');
    expect(getStoredAppTheme('{"state":{"theme":"dark"},"version":0}')).toBe('dark');
    expect(getStoredAppTheme('{"state":{"theme":"unknown"}}')).toBeNull();
    expect(getStoredAppTheme('not-json')).toBeNull();
  });

  it('creates and updates theme shell state on the document', () => {
    document.head.innerHTML = '';
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';

    applyAppTheme('light');

    const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(themeColorMeta?.getAttribute('content')).toBe(APP_THEME_COLOR.light);

    applyAppTheme('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(themeColorMeta?.getAttribute('content')).toBe(APP_THEME_COLOR.dark);
  });

  it('reuses an existing theme-color meta tag when present', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff" />';

    const themeColorMeta = ensureThemeColorMeta(document);
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(themeColorMeta.getAttribute('content')).toBe('#ffffff');
  });
});
