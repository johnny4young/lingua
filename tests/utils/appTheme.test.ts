import { describe, expect, it } from 'vitest';
import {
  APP_THEME_COLOR,
  applyAppTheme,
  ensureThemeColorMeta,
} from '@/utils/appTheme';

describe('appTheme utilities', () => {
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

  it('marks the Ink and Paper palettes and clears them for other themes', () => {
    document.head.innerHTML = '';
    applyAppTheme('dark', document, 'ink');
    const meta = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    expect(document.documentElement.dataset.palette).toBe('ink');
    expect(meta()).toBe('#05090a');

    applyAppTheme('light', document, 'paper');
    expect(document.documentElement.dataset.palette).toBe('paper');
    expect(meta()).toBe('#ffffff');

    applyAppTheme('dark');
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(meta()).toBe(APP_THEME_COLOR.dark);
  });
});
