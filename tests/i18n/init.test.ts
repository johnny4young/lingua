import { describe, it, expect, beforeEach, vi } from 'vitest';
import i18next from 'i18next';
import {
  changeAppLanguage,
  getBrowserSystemLanguages,
  initI18n,
  resolveSystemLanguage,
} from '@/i18n';

describe('initI18n', () => {
  beforeEach(() => {
    // Switch back to English between tests. The singleton init from
    // tests/setup.ts is reused — only the active language changes here.
    if (i18next.isInitialized) {
      i18next.changeLanguage('en');
    }
  });

  it('should initialise with English resources', () => {
    initI18n('en');
    expect(i18next.language).toBe('en');
    expect(i18next.t('settings.title')).toBe('Workspace Settings');
    expect(document.documentElement.lang).toBe('en');
  });

  it('should initialise with Spanish resources', () => {
    initI18n('es');
    expect(i18next.language).toBe('es');
    expect(i18next.t('settings.title')).toBe(
      'Configuración del espacio de trabajo'
    );
    expect(document.documentElement.lang).toBe('es');
  });

  it('should fall back to English for unsupported locales', () => {
    initI18n('fr');
    expect(i18next.language).toBe('en');
    expect(i18next.t('settings.title')).toBe('Workspace Settings');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('resolveSystemLanguage', () => {
  it('should return es for ["es-MX", "en-US"]', () => {
    expect(resolveSystemLanguage(['es-MX', 'en-US'])).toBe('es');
  });

  it('should return en for ["en-US"]', () => {
    expect(resolveSystemLanguage(['en-US'])).toBe('en');
  });

  it('should fall back to en when no language matches', () => {
    expect(resolveSystemLanguage(['fr-FR', 'de-DE'])).toBe('en');
  });

  it('should fall back to en for an empty array', () => {
    expect(resolveSystemLanguage([])).toBe('en');
  });

  it('should match base language without region code', () => {
    expect(resolveSystemLanguage(['es'])).toBe('es');
  });

  it('should be case-insensitive', () => {
    expect(resolveSystemLanguage(['ES-AR'])).toBe('es');
  });
});

describe('getBrowserSystemLanguages', () => {
  it('should prefer navigator.languages when present', () => {
    expect(
      getBrowserSystemLanguages({
        languages: ['es-MX', 'en-US'],
        language: 'en-US',
      })
    ).toEqual(['es-MX', 'en-US']);
  });

  it('should fall back to navigator.language when languages is empty', () => {
    expect(
      getBrowserSystemLanguages({
        languages: [],
        language: 'es-CO',
      })
    ).toEqual(['es-CO']);
  });

  it('should fall back to en when browser locale data is unavailable', () => {
    expect(
      getBrowserSystemLanguages({} as Pick<Navigator, 'languages' | 'language'>)
    ).toEqual(['en']);
  });
});

describe('changeAppLanguage', () => {
  beforeEach(() => {
    initI18n('en');
  });

  it('should switch to an explicit language', async () => {
    const mock = vi.fn();
    await changeAppLanguage('es', mock);
    expect(i18next.language).toBe('es');
    expect(mock).not.toHaveBeenCalled();
  });

  it('should resolve system language via the callback', async () => {
    const mock = vi.fn().mockResolvedValue(['es-MX', 'en-US']);
    await changeAppLanguage('system', mock);
    expect(mock).toHaveBeenCalledOnce();
    expect(i18next.language).toBe('es');
    expect(document.documentElement.lang).toBe('es');
  });

  it('should fall back to en when system languages have no match', async () => {
    const mock = vi.fn().mockResolvedValue(['ja-JP']);
    await changeAppLanguage('system', mock);
    expect(i18next.language).toBe('en');
  });

  it('should fall back to en when reading system languages fails', async () => {
    const mock = vi.fn().mockRejectedValue(new Error('bridge down'));
    await changeAppLanguage('system', mock);
    expect(i18next.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
