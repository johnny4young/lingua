import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMON_NAMESPACE } from '../../src/shared/i18n/languages';

describe('renderer locale bundle boundary', () => {
  const rendererI18n = readFileSync(
    resolve(__dirname, '../../src/renderer/i18n/index.ts'),
    'utf8'
  );
  const languageMetadata = readFileSync(
    resolve(__dirname, '../../src/shared/i18n/languages.ts'),
    'utf8'
  );

  it('keeps English static and Spanish behind a dynamic import', () => {
    expect(rendererI18n).toContain(
      "import en from './locales/en/common.json'"
    );
    expect(rendererI18n).toContain(
      "import('./locales/es/common.json')"
    );
    expect(rendererI18n).not.toContain(
      "from '../../shared/i18n/resources'"
    );
  });

  it('keeps the database connection copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => /^sqlWorkspace\.(connection|guard|remote)\./u.test(key))).toEqual([]);
    expect(rendererI18n).not.toContain("locales/en/sqlConnections.json");
    // Spanish stays complete: its connection copy loads with the lazy Spanish catalog.
    expect(rendererI18n).toContain("import('./locales/es/sqlConnections.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/sqlConnectionsCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/sqlConnections.json'");
  });

  it('keeps the HTTP builder copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => /^httpWorkspace\.(response\.tree|editor\.url\.hint|editor\.tab\.authBadge|editor\.assert)\./u.test(key))).toEqual([]);
    expect(rendererI18n).not.toContain("locales/en/httpBuilder.json");
    expect(rendererI18n).toContain("import('./locales/es/httpBuilder.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/httpBuilderCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/httpBuilder.json'");
    expect(registration).not.toContain('shared/i18n/languages');
    expect(registration).toContain(`addResourceBundle('en', '${COMMON_NAMESPACE}'`);
  });

  it('keeps the newer Labs flag copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('settings.labs.flag.httpScopes.'))).toEqual([]);
    expect(rendererI18n).toContain("import('./locales/es/labs.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/labsCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/labs.json'");
    const labs = readFileSync(resolve(__dirname, '../../src/renderer/components/Settings/LabsSection.tsx'), 'utf8');
    expect(labs).toContain("import '../../i18n/labsCatalog'");
  });

  it('keeps language selection metadata free of catalog imports', () => {
    expect(languageMetadata).not.toMatch(/common\.json/u);
  });
});
