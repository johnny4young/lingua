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

  it('keeps the four prioritized renderer components below 800 lines', () => {
    for (const relativePath of [
      'src/renderer/components/Notebook/NotebookView.tsx',
      'src/renderer/components/SqlWorkspace/SqlResultPreview.tsx',
      'src/renderer/components/CommandPalette/CommandPalette.tsx',
      'src/renderer/components/Editor/EditorTabs.tsx',
    ]) {
      expect(
        physicalLines(relativePath),
        `${relativePath} regressed above the deep-review threshold`
      ).toBeLessThanOrEqual(800);
    }
  });
});
