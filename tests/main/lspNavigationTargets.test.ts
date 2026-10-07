import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  mintRootCapability,
  resolveCapabilityPath,
  revokeRoot,
} from '../../src/main/ipc/projectCapabilities';
import {
  isLspDocumentUriAllowed,
  resolveLspNavigationTarget,
} from '../../src/main/lsp/navigationTargets';
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
  it('accepts destinations a server reports through the realpath of a symlinked root', async () => {
    const parent = await mkdtemp(
      path.join(process.env.LINGUA_SMOKE_FIXTURE_DIR ?? process.cwd(), '.tmp-lsp-navigation-')
    );
    try {
      const real = path.join(parent, 'real');
      const linked = path.join(parent, 'linked');
      await mkdir(path.join(real, 'pkg'), { recursive: true });
      await writeFile(path.join(real, 'pkg', 'helper.go'), 'package pkg');
      await writeFile(path.join(parent, 'outside.go'), 'package outside');
      await symlink(real, linked);
      const grant = mintRootCapability(linked);
      const realRoot = await realpath(real);
      expect(
        await resolveLspNavigationTarget(
          grant.rootId,
          pathToFileURL(path.join(realRoot, 'pkg', 'helper.go')).href
        )
      ).toBe('pkg/helper.go');
      expect(
        await resolveLspNavigationTarget(
          grant.rootId,
          pathToFileURL(path.join(realRoot, '..', 'outside.go')).href
        )
      ).toBeNull();
      revokeRoot(grant.rootId);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it('keeps the symlinked root as the server root and admits documents through either path', async () => {
    const parent = await mkdtemp(
      path.join(process.env.LINGUA_SMOKE_FIXTURE_DIR ?? process.cwd(), '.tmp-lsp-navigation-')
    );
    try {
      const real = path.join(parent, 'real');
      const linked = path.join(parent, 'linked');
      await mkdir(real);
      await writeFile(path.join(real, 'main.go'), 'package main');
      await symlink(real, linked);
      const grant = mintRootCapability(linked);
      const resolved = await resolveCapabilityPath(grant.rootId, '', 'read');
      expect(resolved).toMatchObject({ ok: true, rootPath: linked, absolutePath: await realpath(real) });
      if (!resolved.ok) throw new Error('unreachable');
      const bases = [resolved.rootPath, resolved.absolutePath];
      expect(
        await resolveLspNavigationTarget(
          grant.rootId,
          pathToFileURL(path.join(linked, 'main.go')).href
        )
      ).toBe('main.go');
      expect(isLspDocumentUriAllowed(pathToFileURL(path.join(linked, 'main.go')).href, bases)).toBe(true);
      expect(
        isLspDocumentUriAllowed(pathToFileURL(path.join(resolved.absolutePath, 'main.go')).href, bases)
      ).toBe(true);
      expect(isLspDocumentUriAllowed(pathToFileURL(path.join(parent, 'other.go')).href, bases)).toBe(
        false
      );
      expect(isLspDocumentUriAllowed('file:///__lingua_unsaved__/tab/main.go', bases)).toBe(true);
      expect(isLspDocumentUriAllowed(pathToFileURL(path.join(parent, 'x.go')).href, null)).toBe(true);
      expect(isLspDocumentUriAllowed('file://host/x.go', null)).toBe(false);
      revokeRoot(grant.rootId);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
