import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const electronMocks = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockGetPath: vi.fn(() => '/tmp/lingua-user-data'),
  mockGetVersion: vi.fn(() => '0.1.0'),
}));

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.mockGetPath,
    getVersion: electronMocks.mockGetVersion,
  },
  ipcMain: {
    handle: electronMocks.mockHandle,
  },
}));

import {
  getPluginInstallDirectory,
  listInstalledPlugins,
  pluginManifestHelpers,
  registerPluginHandlers,
} from '../../src/main/plugins';

async function writeManifest(
  parentDirectory: string,
  pluginDirectoryName: string,
  manifest: unknown
): Promise<string> {
  const installDirectory = path.join(parentDirectory, pluginDirectoryName);
  await mkdir(installDirectory, { recursive: true });
  const manifestPath = path.join(installDirectory, 'plugin.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}

describe('main plugin manifest helpers', () => {
  it('compares semantic versions numerically', () => {
    expect(pluginManifestHelpers.compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(pluginManifestHelpers.compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(pluginManifestHelpers.compareVersions('1.2', '1.2.1')).toBe(-1);
  });

  it('marks malformed manifests as invalid', () => {
    const result = pluginManifestHelpers.validateManifest(
      { apiVersion: 1 },
      '/tmp/plugins/broken/plugin.json',
      '0.1.0'
    );

    expect(result.status).toBe('invalid');
    expect(result.message).toMatch(/pluginId/i);
  });

  it('marks unsupported api versions as incompatible', () => {
    const result = pluginManifestHelpers.validateManifest(
      { pluginId: 'lua', apiVersion: 2 },
      '/tmp/plugins/lua/plugin.json',
      '0.1.0'
    );

    expect(result.status).toBe('incompatible');
    expect(result.message).toMatch(/expected 1/i);
  });
});

describe('main plugin discovery', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-plugins-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('discovers valid, disabled, incompatible, unknown, and broken manifests', async () => {
    // RL-084 — fixtures cover every distinct status the validator can
    // emit. Two `lua` directories share the same pluginId by design;
    // discovery returns one record per directory, sorted by pluginId,
    // with the second one's directory name disambiguating in
    // `manifestPath`. The disabled-flag is the only difference.
    await writeManifest(tempRoot, 'lua', {
      pluginId: 'lua',
      apiVersion: 1,
    });
    await writeManifest(tempRoot, 'lua-disabled-instance', {
      pluginId: 'lua',
      apiVersion: 1,
      enabled: false,
    });
    await writeManifest(tempRoot, 'future-plugin', {
      pluginId: 'lua',
      apiVersion: 1,
      minAppVersion: '9.0.0',
    });
    await writeManifest(tempRoot, 'incompatible-api', {
      pluginId: 'lua',
      apiVersion: 99,
    });
    await writeManifest(tempRoot, 'unknown-runtime', {
      pluginId: 'ruby',
      apiVersion: 1,
    });
    const brokenDirectory = path.join(tempRoot, 'broken-plugin');
    await mkdir(brokenDirectory, { recursive: true });
    await writeFile(path.join(brokenDirectory, 'plugin.json'), '{not-json', 'utf8');

    const plugins = await listInstalledPlugins(tempRoot, '0.1.0');

    const byDirectory = (dir: string) =>
      plugins.find((plugin) => plugin.installDirectory.endsWith(dir));

    expect(byDirectory('lua')?.status).toBe('loaded');
    expect(byDirectory('lua-disabled-instance')?.status).toBe('disabled');
    // Two flavours of incompatible: apiVersion mismatch (`99`) and
    // version range out of bounds (`minAppVersion: 9.0.0` against
    // `appVersion: 0.1.0`). Both surface as `incompatible` per the
    // validator; the diagnostic message disambiguates.
    expect(byDirectory('incompatible-api')?.status).toBe('incompatible');
    expect(byDirectory('incompatible-api')?.message).toMatch(/API version 99/);
    expect(byDirectory('future-plugin')?.status).toBe('incompatible');
    expect(byDirectory('future-plugin')?.message).toMatch(/>= 9\.0\.0/);
    expect(byDirectory('unknown-runtime')?.status).toBe('unknown');
    expect(byDirectory('unknown-runtime')?.diagnostic).toEqual({
      key: 'unknown',
      params: { pluginId: 'ruby' },
    });
    expect(byDirectory('broken-plugin')?.status).toBe('invalid');
    expect(byDirectory('broken-plugin')?.diagnostic?.key).toBe('loadFailed');
  });

  it('rejects manifests with path-traversal pluginIds as invalid', async () => {
    // RL-084 — even if someone drops a manifest with `pluginId: '..'`
    // into the plugins directory, the validator must catch it before
    // any downstream consumer sees it.
    await writeManifest(tempRoot, 'malicious', {
      pluginId: '../traversal',
      apiVersion: 1,
    });

    const plugins = await listInstalledPlugins(tempRoot, '0.1.0');
    const record = plugins[0];
    expect(record).toBeDefined();
    expect(record?.status).toBe('invalid');
    expect(record?.message).toMatch(/not a safe identifier/);
  });

  it('rejects manifests with unknown extra fields as invalid', async () => {
    // RL-084 — defense in depth: a manifest that tries to smuggle
    // an `executable` or `command` key gets rejected even if every
    // documented field is well-formed.
    await writeManifest(tempRoot, 'lua-with-extras', {
      pluginId: 'lua',
      apiVersion: 1,
      executable: '/bin/sh',
    });

    const plugins = await listInstalledPlugins(tempRoot, '0.1.0');
    const record = plugins[0];
    expect(record?.status).toBe('invalid');
    expect(record?.message).toMatch(/unknown fields: executable/);
  });
});

describe('main plugin IPC registration', () => {
  beforeEach(() => {
    electronMocks.mockHandle.mockClear();
  });

  it('registers plugin IPC handlers', () => {
    registerPluginHandlers();

    expect(electronMocks.mockHandle).toHaveBeenCalledWith(
      'plugins:get-install-directory',
      expect.any(Function)
    );
    expect(electronMocks.mockHandle).toHaveBeenCalledWith(
      'plugins:list',
      expect.any(Function)
    );
  });

  it('builds the install directory from userData', () => {
    expect(getPluginInstallDirectory()).toBe('/tmp/lingua-user-data/plugins');
  });
});
