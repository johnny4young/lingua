import { readdirSync, readFileSync } from 'node:fs';
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
const headersModule = 'src/shared/httpWorkspaceHeaders.ts';
const curlModule = 'src/shared/httpWorkspaceCurl.ts';
const implementationModule = 'src/shared/httpWorkspace.ts';
const confirmationModule = 'src/renderer/hooks/importPreviewConfirm.ts';
const responsePreviewModule =
  'src/renderer/components/HttpWorkspace/HttpResponsePreview.tsx';
const requestEditorModule =
  'src/renderer/components/HttpWorkspace/HttpRequestEditor.tsx';
const httpClientModule = 'src/renderer/runtime/httpClient.ts';
const httpProxyModule = 'src/main/httpProxy.ts';
const httpCodegenModule = 'src/shared/httpCodegen.ts';

function sourceModules(directory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, directory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) return sourceModules(relativePath);
      return /\.(?:ts|tsx)$/u.test(entry.name) ? [relativePath] : [];
    }
  );
}

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

  it('keeps header resolution independent and directly owned by wire consumers', () => {
    const headersSource = readFileSync(path.join(repoRoot, headersModule), 'utf8');
    expect(staticSpecifiers(headersSource)).toEqual(['./httpSensitiveHeaders']);
    expect(headersSource).toContain("from './httpWorkspaceSchema'");
    expect(headersSource).not.toContain("from './httpWorkspace'");

    for (const consumerModule of [
      httpClientModule,
      httpProxyModule,
      httpCodegenModule,
    ]) {
      const consumerSource = readFileSync(
        path.join(repoRoot, consumerModule),
        'utf8'
      );
      expect(consumerSource).toContain('httpWorkspaceHeaders');
      expect(consumerSource).not.toContain("from '../../shared/httpWorkspace'");
      expect(consumerSource).not.toContain("from '../shared/httpWorkspace'");
      expect(consumerSource).not.toContain("from './httpWorkspace'");
    }
  });

  it('keeps cURL serialization isolated and the historical facade out of production imports', () => {
    const curlSource = readFileSync(path.join(repoRoot, curlModule), 'utf8');
    expect(staticSpecifiers(curlSource)).toEqual(['./httpWorkspaceHeaders']);
    expect(curlSource).toContain("from './httpWorkspaceSchema'");
    expect(curlSource).not.toContain("from './httpWorkspace'");

    const editorSource = readFileSync(
      path.join(repoRoot, requestEditorModule),
      'utf8'
    );
    expect(editorSource).toContain("from '../../../shared/httpWorkspaceCurl'");

    const facadeSource = readFileSync(
      path.join(repoRoot, implementationModule),
      'utf8'
    );
    expect(facadeSource).toContain("export * from './httpWorkspaceCurl'");
    expect(facadeSource).not.toMatch(/\bfunction\s+[A-Za-z_$]/u);

    const facadeImporters = sourceModules('src').filter((sourceModule) => {
      const source = readFileSync(path.join(repoRoot, sourceModule), 'utf8');
      return /\bfrom\s*['"][^'"]*\/httpWorkspace['"]/u.test(source);
    });
    expect(facadeImporters).toEqual([]);
  });
});
