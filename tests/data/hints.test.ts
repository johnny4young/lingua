import { describe, expect, it } from 'vitest';
import {
  CONTEXTUAL_HINTS,
  currentHintPlatform,
  hintsForSurface,
  selectContextualHint,
} from '../../src/renderer/data/hints';
import en from '../../src/renderer/i18n/locales/en/common.json';
import es from '../../src/renderer/i18n/locales/es/common.json';

describe('contextual hint catalog', () => {
  it('keeps a closed 20-entry catalog with unique ids and localized keys', () => {
    expect(CONTEXTUAL_HINTS).toHaveLength(20);
    expect(new Set(CONTEXTUAL_HINTS.map(hint => hint.id)).size).toBe(20);
    expect(CONTEXTUAL_HINTS.every(hint => hint.i18nKey.startsWith('hints.'))).toBe(true);

    const locales = [en, es] as ReadonlyArray<Record<string, string>>;
    for (const key of ['hints.label', 'hints.disable', ...CONTEXTUAL_HINTS.map(hint => hint.i18nKey)]) {
      expect(locales.every(locale => typeof locale[key] === 'string' && locale[key]!.length > 0), key).toBe(true);
    }
  });

  it('selects deterministically for one session seed and rotates across seeds', () => {
    expect(selectContextualHint('console', 3, 'web')).toEqual(
      selectContextualHint('console', 3, 'web')
    );
    expect(selectContextualHint('console', 3, 'web')?.id).not.toBe(
      selectContextualHint('console', 4, 'web')?.id
    );
  });

  it('filters desktop-only capabilities before web selection', () => {
    const webHints = hintsForSurface('palette', 'web');
    const desktopHints = hintsForSurface('palette', 'desktop');

    expect(webHints.some(hint => hint.id.includes('go-desktop'))).toBe(false);
    expect(webHints.some(hint => hint.id.includes('project-templates-desktop'))).toBe(false);
    expect(desktopHints.some(hint => hint.id.includes('go-desktop'))).toBe(true);
    expect(desktopHints.some(hint => hint.id.includes('project-templates-desktop'))).toBe(true);
  });

  it('fails safely to web when no renderer bridge is installed', () => {
    const original = window.lingua;
    Object.defineProperty(window, 'lingua', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      expect(currentHintPlatform()).toBe('web');
    } finally {
      Object.defineProperty(window, 'lingua', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
