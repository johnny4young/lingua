import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRendererViteAliases, createWebViteAliases } from '../../build/viteAliases.mts';
import { walkStaticImportGraph } from '../../scripts/lib/staticImportGraph.mjs';

const repoRoot = path.resolve(__dirname, '../..');
describe('manual notebook save chunk boundary', () => {
  for (const [surface, makeAliases] of [
    ['web', createWebViteAliases],
    ['renderer', createRendererViteAliases],
  ] as const) {
    it(`does not load save actions or disk writer for dirty tracking (${surface})`, () => {
      const aliases = Object.entries(makeAliases(repoRoot)).map(
        ([key, value]) =>
          [key, path.relative(repoRoot, value).split(path.sep).join('/')] as [string, string]
      );
      const { parents } = walkStaticImportGraph({
        repoRoot,
        aliases,
        entry: 'src/renderer/stores/editorStore.ts',
      });
      expect(parents.has('src/renderer/stores/editorDocumentSave.ts')).toBe(false);
      expect(parents.has('src/renderer/stores/editorDocumentOpen.ts')).toBe(false);
      expect(parents.has('src/renderer/stores/notebookDocumentWrite.ts')).toBe(false);
      expect(parents.has('src/renderer/stores/notebookDocumentRecovery.ts')).toBe(false);
      expect(parents.has('src/renderer/stores/notebookDocumentOpen.ts')).toBe(false);
      const watch = walkStaticImportGraph({
        repoRoot,
        aliases,
        entry: 'src/renderer/hooks/projectWatchReload.ts',
      });
      expect(watch.parents.has('src/renderer/hooks/notebookDocumentExternalReload.ts')).toBe(false);
    });
  }
  it('does not make web file commits load Capsule parsing or redaction', () => {
    const { parents } = walkStaticImportGraph({ repoRoot, entry: 'src/web/fs-adapter.ts' });
    expect(parents.has('src/shared/runCapsule.ts')).toBe(false);
    expect(parents.has('src/shared/contentHash.ts')).toBe(true);
  });
  it('retains the explicit save routes and document writer', () => {
    const actions = readFileSync(
      path.join(repoRoot, 'src/renderer/stores/editorSaveActions.ts'),
      'utf8'
    );
    const save = readFileSync(
      path.join(repoRoot, 'src/renderer/stores/editorDocumentSave.ts'),
      'utf8'
    );
    expect(actions).toContain("import('./editorDocumentSave')");
    expect(save).toContain("import('./notebookDocumentWrite')");
    expect(save).toContain('persistNotebookDocument(');
  });
});
