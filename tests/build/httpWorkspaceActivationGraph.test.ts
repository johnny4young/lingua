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
const persistenceModule = 'src/shared/httpWorkspacePersistence.ts';
const capturesModule = 'src/shared/httpWorkspaceCaptures.ts';
const assertionsModule = 'src/shared/httpWorkspaceAssertions.ts';
const queryModule = 'src/shared/httpWorkspaceQuery.ts';
const implementationModule = 'src/shared/httpWorkspace.ts';
const confirmationModule = 'src/renderer/hooks/importPreviewConfirm.ts';
const responsePreviewModule =
  'src/renderer/components/HttpWorkspace/HttpResponsePreview.tsx';
const requestEditorModule =
  'src/renderer/components/HttpWorkspace/HttpRequestEditor.tsx';

describe('HTTP workspace activation boundary', () => {
  it('keeps full HTTP behavior behind Import Preview confirmation', () => {
    const { parents } = walkStaticImportGraph({
      repoRoot,
      entry: importPreviewEntry,
    });

    expect(parents.size).toBeGreaterThan(40);
    expect(parents.has(schemaModule)).toBe(true);

    for (const deferredModule of [
      persistenceModule,
      implementationModule,
      confirmationModule,
    ]) {
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

  it('loads persistence parsing without activating full HTTP behavior on confirmation', () => {
    const { parents } = walkStaticImportGraph({
      repoRoot,
      entry: confirmationModule,
    });

    expect(parents.has(schemaModule)).toBe(true);
    expect(parents.has(persistenceModule)).toBe(true);
    expect(
      parents.has(implementationModule),
      `${implementationModule} joined confirmation via ${importChain(
        parents,
        implementationModule
      ).join(' -> ')}`
    ).toBe(false);
  });

  it('keeps persistence parsing dependent only on the schema leaf', () => {
    const source = readFileSync(path.join(repoRoot, persistenceModule), 'utf8');
    expect(staticSpecifiers(source)).toEqual(['./httpWorkspaceSchema']);
    expect(source).not.toMatch(/\bimport\s*\(/u);
    expect(source).not.toContain("from './httpWorkspace'");
  });

  it('keeps captures and assertions independent from the implementation facade', () => {
    const capturesSource = readFileSync(path.join(repoRoot, capturesModule), 'utf8');
    expect(staticSpecifiers(capturesSource)).toEqual([]);
    expect(capturesSource).toContain("from './httpWorkspaceSchema'");
    expect(capturesSource).not.toContain("from './httpWorkspace'");

    const assertionsSource = readFileSync(
      path.join(repoRoot, assertionsModule),
      'utf8'
    );
    expect(staticSpecifiers(assertionsSource)).toEqual([
      './httpWorkspaceCaptures',
    ]);
    expect(assertionsSource).toContain("from './httpWorkspaceSchema'");
    expect(assertionsSource).not.toContain("from './httpWorkspace'");
  });

  it('lets response previews evaluate assertions without the full implementation', () => {
    const { parents } = walkStaticImportGraph({
      repoRoot,
      entry: responsePreviewModule,
    });

    expect(parents.has(assertionsModule)).toBe(true);
    expect(parents.has(capturesModule)).toBe(true);
    expect(
      parents.has(implementationModule),
      `${implementationModule} joined response preview via ${importChain(
        parents,
        implementationModule
      ).join(' -> ')}`
    ).toBe(false);
  });

  it('keeps query synchronization schema-only and directly owned by the editor', () => {
    const querySource = readFileSync(path.join(repoRoot, queryModule), 'utf8');
    expect(staticSpecifiers(querySource)).toEqual([]);
    expect(querySource).toContain("from './httpWorkspaceSchema'");
    expect(querySource).not.toContain("from './httpWorkspace'");

    const editorSource = readFileSync(
      path.join(repoRoot, requestEditorModule),
      'utf8'
    );
    expect(editorSource).toContain("from '../../../shared/httpWorkspaceQuery'");
  });
});
