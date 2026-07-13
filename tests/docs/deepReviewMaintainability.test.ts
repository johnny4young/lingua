import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function physicalLines(relativePath: string): number {
  return source(relativePath).trimEnd().split('\n').length;
}

describe('deep-review maintainability boundaries', () => {
  it('keeps fileSystem as assembly and every focused group below 600 lines', () => {
    const assembly = source('src/main/ipc/fileSystem.ts');
    expect(physicalLines('src/main/ipc/fileSystem.ts')).toBeLessThanOrEqual(100);
    expect(assembly).not.toContain('typedHandle(');
    for (const moduleName of [
      'fsApprovals',
      'fsBundle',
      'fsOperations',
      'fsSearchReplace',
      'fsShared',
      'fsWatchers',
    ]) {
      expect(
        physicalLines(`src/main/ipc/fs/${moduleName}.ts`),
        `${moduleName} exceeded the IT2-A1 module budget`
      ).toBeLessThanOrEqual(600);
    }
  });

  it('keeps completed renderer splits within their maintainability budgets', () => {
    for (const [relativePath, budget] of [
      ['src/renderer/components/Notebook/NotebookView.tsx', 800],
      ['src/renderer/components/SqlWorkspace/SqlResultPreview.tsx', 800],
      ['src/renderer/components/CommandPalette/CommandPalette.tsx', 800],
      ['src/renderer/components/Editor/EditorTabs.tsx', 800],
      ['src/renderer/components/Settings/EditorSection.tsx', 800],
      [
        'src/renderer/components/DeveloperUtilities/UtilityPipelinePanel.tsx',
        800,
      ],
      ['src/renderer/components/HttpWorkspace/HttpRequestEditor.tsx', 800],
      ['src/renderer/components/Settings/SettingsModal.tsx', 800],
      ['src/renderer/components/Console/ConsolePanel.tsx', 800],
      ['src/renderer/components/SqlWorkspace/SqlWorkspacePanel.tsx', 800],
      [
        'src/renderer/components/Settings/SqlWorkspaceSettingsSection.tsx',
        400,
      ],
      [
        'src/renderer/components/DeveloperUtilities/UtilityPipelineLibrarySidebar.tsx',
        400,
      ],
      [
        'src/renderer/components/DeveloperUtilities/UtilityPipelineResults.tsx',
        300,
      ],
      [
        'src/renderer/components/HttpWorkspace/HttpRequestBuilderTabs.tsx',
        400,
      ],
      ['src/renderer/components/Settings/SettingsRail.tsx', 150],
      ['src/renderer/components/Settings/settingsRailModel.ts', 250],
      ['src/renderer/components/Console/ConsoleEntryRow.tsx', 250],
      [
        'src/renderer/components/SqlWorkspace/SqlWorkspaceImportToolbar.tsx',
        150,
      ],
    ] as const) {
      expect(
        physicalLines(relativePath),
        `${relativePath} regressed above its deep-review budget`
      ).toBeLessThanOrEqual(budget);
    }
  });

  it('keeps completed oversized hooks and their helpers focused', () => {
    for (const [relativePath, budget] of [
      ['src/renderer/hooks/useAutoRun.ts', 300],
      ['src/renderer/hooks/autoRunExecution.ts', 300],
      ['src/renderer/hooks/autoRunResult.ts', 180],
      ['src/renderer/hooks/autoRunModel.ts', 120],
      ['src/renderer/hooks/useImportPreview.ts', 200],
      ['src/renderer/hooks/importPreviewModel.ts', 250],
      ['src/renderer/hooks/importPreviewConfirm.ts', 300],
      ['src/renderer/hooks/useGlobalShortcuts.ts', 120],
      ['src/renderer/hooks/globalShortcutTypes.ts', 120],
      ['src/renderer/hooks/globalShortcutModel.ts', 80],
      ['src/renderer/hooks/globalShortcutActions.ts', 180],
      ['src/renderer/hooks/globalShortcutUtilities.ts', 180],
    ] as const) {
      expect(
        physicalLines(relativePath),
        `${relativePath} regressed above its IT2-A5 budget`
      ).toBeLessThanOrEqual(budget);
    }
  });
});
