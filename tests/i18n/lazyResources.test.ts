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

  it('keeps the native SQL engine copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => /^(settings\.editor\.sqlWorkspace\.localEngine\.|sqlWorkspace\.nativeEngine\.)/u.test(key))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/sqlLocalEngine.json');
    expect(rendererI18n).toContain("import('./locales/es/sqlLocalEngine.json')");
    for (const file of ['components/Settings/SqlLocalEngineRow.tsx', 'components/Settings/SqlWorkspaceSettingsSection.tsx']) {
      expect(readFileSync(resolve(__dirname, `../../src/renderer/${file}`), 'utf8')).toContain("import '../../i18n/sqlLocalEngineCatalog'");
    }
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

  it('keeps the timeline copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('timeline.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/timeline.json');
    expect(rendererI18n).toContain("import('./locales/es/timeline.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/timelineCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/timeline.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/Timeline/TimelinePanel.tsx'), 'utf8')).toContain("import '../../i18n/timelineCatalog'");
  });

  it('keeps the Start copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('start.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/start.json');
    expect(rendererI18n).toContain("import('./locales/es/start.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/startCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/start.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/Editor/EditorEmptyState.tsx'), 'utf8')).toContain("import '../../i18n/startCatalog'");
  });

  it('keeps the notebook answer copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('notebookAnswers.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/notebook.json');
    expect(rendererI18n).toContain("import('./locales/es/notebook.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/notebookCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/notebook.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/Notebook/NotebookCellAnswers.tsx'), 'utf8')).toContain("import '../../i18n/notebookCatalog'");
  });

  it('keeps the answer object copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('answers.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/answers.json');
    expect(rendererI18n).toContain("import('./locales/es/answers.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/answersCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/answers.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/Answer/AnswerObject.tsx'), 'utf8')).toContain("import '../../i18n/answersCatalog'");
  });

  it('keeps the run regions copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('runRegions.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/runRegions.json');
    expect(rendererI18n).toContain("import('./locales/es/runRegions.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/runRegionsCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/runRegions.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/RunRegions/RunRegions.tsx'), 'utf8')).toContain("import '../../i18n/runRegionsCatalog'");
  });

  it('keeps the Instant SQL copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('sqlWorkspace.instant.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/sqlInstant.json');
    expect(rendererI18n).toContain("import('./locales/es/sqlInstant.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/sqlInstantCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/sqlInstant.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/SqlWorkspace/SqlInstantPreview.tsx'), 'utf8')).toContain("import '../../i18n/sqlInstantCatalog'");
  });

  it('keeps the capsule import copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('capsuleImport.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/capsuleImport.json');
    expect(rendererI18n).toContain("import('./locales/es/capsuleImport.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/capsuleImportCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/capsuleImport.json'");
    for (const file of ['CapsuleImport/CapsuleImportOverlay.tsx', 'CapsuleImport/CapsuleImportPreview.tsx', 'CapsuleList/CapsuleListOverlay.tsx']) {
      expect(readFileSync(resolve(__dirname, `../../src/renderer/components/${file}`), 'utf8')).toContain("import '../../i18n/capsuleImportCatalog'");
    }
  });

  it('keeps the Settings privacy copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('settings.privacy.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/settingsPrivacy.json');
    expect(rendererI18n).toContain("import('./locales/es/settingsPrivacy.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/settingsPrivacyCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/settingsPrivacy.json'");
    for (const file of ['PrivacySection.tsx', 'PrivacyTrustSection.tsx', 'NetworkPolicyRows.tsx', 'LocalDataSummary.tsx', 'settingsSearchModel.ts']) {
      expect(readFileSync(resolve(__dirname, `../../src/renderer/components/Settings/${file}`), 'utf8')).toContain("import '../../i18n/settingsPrivacyCatalog'");
    }
  });

  it('keeps the clipboard copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('utilities.clipboard.'))).toEqual([]);
    expect(bootCatalog['utilities.settings.clipboardOnFocus.hint']).toBeUndefined();
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/Settings/UtilitiesSection.tsx'), 'utf8')).toContain("import '../../i18n/clipboardChainsCatalog'");
    expect(rendererI18n).not.toContain('locales/en/clipboardChains.json');
    expect(rendererI18n).toContain("import('./locales/es/clipboardChains.json')");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/DeveloperUtilities/UtilityLauncherList.tsx'), 'utf8')).toContain("import '../../i18n/clipboardChainsCatalog'");
  });

  it('keeps the pipeline export copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('utilityPipeline.eject.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/pipelineJs.json');
    expect(rendererI18n).toContain("import('./locales/es/pipelineJs.json')");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/DeveloperUtilities/UtilityPipelinePanel.tsx'), 'utf8')).toContain("import '../../i18n/pipelineJsCatalog'");
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

  it('keeps the Local MCP copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('settings.localMcp.'))).toEqual([]);
    expect(rendererI18n).toContain("import('./locales/es/localMcp.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/localMcpCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/localMcp.json'");
    const section = readFileSync(resolve(__dirname, '../../src/renderer/components/Settings/LocalMcpSection.tsx'), 'utf8');
    expect(section).toContain("import '../../i18n/localMcpCatalog'");
  });

  it('keeps the project explorer copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    const explorerKeys = Object.keys(JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/explorer.json'), 'utf8')
    ) as Record<string, string>);
    expect(explorerKeys.length).toBeGreaterThan(0);
    expect(explorerKeys.filter((key) => key in bootCatalog)).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/explorer.json');
    expect(rendererI18n).toContain("import('./locales/es/explorer.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/explorerCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/explorer.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/FileTree/FileTree.tsx'), 'utf8')).toContain("import '../../i18n/explorerCatalog'");
  });

  it('keeps the cron phrase copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('utilities.tool.cron.phrase.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/cronPhrase.json');
    expect(rendererI18n).toContain("import('./locales/es/cronPhrase.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/cronPhraseCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/cronPhrase.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/DeveloperUtilities/panels/CronPhraseComposer.tsx'), 'utf8')).toContain("import '../../../i18n/cronPhraseCatalog'");
  });

  it('keeps the tool answer copy out of the English boot catalog', () => {
    const bootCatalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/renderer/i18n/locales/en/common.json'), 'utf8')
    ) as Record<string, string>;
    expect(Object.keys(bootCatalog).filter((key) => key.startsWith('utilities.answer.'))).toEqual([]);
    expect(rendererI18n).not.toContain('locales/en/toolAnswers.json');
    expect(rendererI18n).toContain("import('./locales/es/toolAnswers.json')");
    const registration = readFileSync(resolve(__dirname, '../../src/renderer/i18n/toolAnswersCatalog.ts'), 'utf8');
    expect(registration).toContain("import en from './locales/en/toolAnswers.json'");
    expect(readFileSync(resolve(__dirname, '../../src/renderer/components/DeveloperUtilities/ToolAnswerParts.tsx'), 'utf8')).toContain("import '../../i18n/toolAnswersCatalog'");
  });

  it('keeps language selection metadata free of catalog imports', () => {
    expect(languageMetadata).not.toMatch(/common\.json/u);
  });
});
