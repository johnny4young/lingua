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

  it('keeps the debugger panel copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('debugger.') && !key.startsWith('debugger.gutter.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/debugger.json');
    expect(rendererI18n).toContain("import('./locales/es/debugger.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/debuggerCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/debugger.json'");
    const drawer = readFileSync(resolve(__dirname, '../../src/renderer/components/Debugger/DebuggerDrawer.tsx'), 'utf8');
    expect(drawer).toContain("import '../../i18n/debuggerCatalog'");
  });

  it('keeps the explain panel and error row copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('ai.panel.') || key.startsWith('errorRow.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/explain.json');
    expect(rendererI18n).toContain("import('./locales/es/explain.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/explainCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/explain.json'");
    for (const file of ['ExplainErrorPanel.tsx', 'ErrorLineRow.tsx']) {
      expect(readFileSync(resolve(__dirname, `../../src/renderer/components/AI/${file}`), 'utf8')).toContain("import '../../i18n/explainCatalog'");
    }
  });

  it('keeps the Tests tab copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('projectTests.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/tests.json');
    expect(rendererI18n).toContain("import('./locales/es/tests.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/testsCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/tests.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/ProjectTests/TestsPanel.tsx'), 'utf8')).toContain("import '../../i18n/testsCatalog'");
  });

  it('keeps the Compare runs copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('runCompare.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/runCompare.json');
    expect(rendererI18n).toContain("import('./locales/es/runCompare.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/runCompareCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/runCompare.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/RunCompare/RunComparePanel.tsx'), 'utf8')).toContain("import '../../i18n/runCompareCatalog'");
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
