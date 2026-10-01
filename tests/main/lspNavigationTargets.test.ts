import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mintRootCapability, revokeRoot } from '../../src/main/ipc/projectCapabilities';
import { resolveLspNavigationTarget } from '../../src/main/lsp/navigationTargets';
import {
  normalizeLspLocations,
  readLspNavigationCapabilities,
} from '../../src/shared/lspNavigation';

describe('LSP navigation data', () => {
  const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 4 } };
  it('normalizes Location and LocationLink selections without granting access', () => {
    expect(
      normalizeLspLocations([
        { uri: 'file:///a.go', range },
        {
          targetUri: 'file:///b.rs',
          targetRange: { ...range, end: { line: 10, character: 0 } },
          targetSelectionRange: range,
        },
      ])
    ).toEqual([
      { uri: 'file:///a.go', range },
      { uri: 'file:///b.rs', range },
    ]);
    expect(
      normalizeLspLocations({
        uri: 'file:///a.go',
        range: { ...range, start: { line: -1, character: 0 } },
      })
    ).toEqual([]);
    expect(
      normalizeLspLocations(Array.from({ length: 1001 }, () => ({ uri: 'file:///a.go', range })))
    ).toEqual([]);
  });
  it('requires declared server capabilities', () => {
    expect(
      readLspNavigationCapabilities({
        capabilities: { definitionProvider: false, referencesProvider: {} },
      })
    ).toEqual({ definition: false, references: true });
    expect(readLspNavigationCapabilities(null)).toEqual({ definition: false, references: false });
  });
  it('resolves only real files under a live authorized root, including Unicode and spaces', async () => {
    // Safe project-owned fixture; actual capabilities and denylist remain enabled.
    const parent = await mkdtemp(
      path.join(process.env.LINGUA_SMOKE_FIXTURE_DIR ?? process.cwd(), '.tmp-lsp-navigation-')
    );
    try {
      const root = path.join(parent, 'project');
      await mkdir(root);
      const file = path.join(root, 'á target.go');
      const external = path.join(parent, 'outside.go');
      await writeFile(file, 'package main');
      await writeFile(external, 'package outside');
      await symlink(external, path.join(root, 'escape.go'));
      const grant = mintRootCapability(root);
      expect(await resolveLspNavigationTarget(grant.rootId, pathToFileURL(file).href)).toBe(
        'á target.go'
      );
      for (const uri of [
        pathToFileURL(external).href,
        pathToFileURL(path.join(root, 'escape.go')).href,
        pathToFileURL(root).href,
        'https://example.test/a',
        'file://remote/a',
        'file:///bad%2Fpath',
        `${pathToFileURL(file).href}?query`,
        'not a uri',
      ])
        expect(await resolveLspNavigationTarget(grant.rootId, uri)).toBeNull();
      revokeRoot(grant.rootId);
      expect(await resolveLspNavigationTarget(grant.rootId, pathToFileURL(file).href)).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
