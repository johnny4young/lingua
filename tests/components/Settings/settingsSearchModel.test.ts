import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../../src/renderer/i18n';
import { searchSettings } from '../../../src/renderer/components/Settings/settingsSearchModel';

describe('searchSettings', () => {
  beforeAll(async () => {
    await initI18n();
  });

  it('finds individual controls instead of only their rail tab', async () => {
    await i18next.changeLanguage('en');

    const results = searchSettings('font size', i18next.t.bind(i18next));

    expect(results[0]?.id).toBe('font-size');
    expect(results[0]?.tab).toBe('editor');
    expect(results[0]?.targetId).toBe('editor-font-size');
  });

  it('matches localized labels and accent-insensitive Spanish aliases', async () => {
    await i18next.changeLanguage('es');

    expect(
      searchSettings('telemetria', i18next.t.bind(i18next))[0]?.id
    ).toBe('telemetry');
    expect(
      searchSettings('tamaño fuente', i18next.t.bind(i18next))[0]?.id
    ).toBe('font-size');
  });

  it('requires every query token and leaves blank searches closed', async () => {
    await i18next.changeLanguage('en');

    expect(searchSettings('', i18next.t.bind(i18next))).toEqual([]);
    expect(
      searchSettings('runtime worker', i18next.t.bind(i18next))[0]?.id
    ).toBe('default-runtime');
    expect(searchSettings('runtime telemetry', i18next.t.bind(i18next))).toEqual(
      []
    );
  });
});
