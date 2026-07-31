import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  importChain,
  staticSpecifiers,
  walkStaticImportGraph,
} from '../../scripts/lib/staticImportGraph.mjs';

const repoRoot = path.resolve(__dirname, '../..');
const importPreviewEntry =
  'src/renderer/components/ImportPreview/ImportPreviewOverlay.tsx';
const schemaModule = 'src/shared/httpWorkspaceSchema.ts';
const implementationModule = 'src/shared/httpWorkspace.ts';
const confirmationModule = 'src/renderer/hooks/importPreviewConfirm.ts';

describe('HTTP workspace activation boundary', () => {
  it('keeps full HTTP behavior behind Import Preview confirmation', () => {
    const { parents } = walkStaticImportGraph({
      repoRoot,
      entry: importPreviewEntry,
    });

    expect(parents.size).toBeGreaterThan(40);
    expect(parents.has(schemaModule)).toBe(true);

    for (const deferredModule of [implementationModule, confirmationModule]) {
      expect(
        parents.has(deferredModule),
        `${deferredModule} joined the Import Preview graph via ${importChain(
          parents,
          deferredModule
        ).join(' -> ')}`
      ).toBe(false);
    }
  });

  it('keeps the schema leaf independent from the implementation facade', () => {
    const source = readFileSync(path.join(repoRoot, schemaModule), 'utf8');
    expect(staticSpecifiers(source)).toEqual([]);
    expect(source).not.toMatch(/\bimport\s*\(/u);
  });
});
