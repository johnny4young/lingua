import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const electronMocks = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockGetPath: vi.fn(() => '/tmp/runlang-user-data'),
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
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'runlang-plugins-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('discovers valid, disabled, incompatible, and broken manifests', async () => {
    await writeManifest(tempRoot, 'lua', {
      pluginId: 'lua',
      apiVersion: 1,
    });
    await writeManifest(tempRoot, 'lua-disabled', {
      pluginId: 'lua-disabled',
      apiVersion: 1,
      enabled: false,
    });
    await writeManifest(tempRoot, 'future-plugin', {
      pluginId: 'future-plugin',
      apiVersion: 1,
      minAppVersion: '9.0.0',
    });
    const brokenDirectory = path.join(tempRoot, 'broken-plugin');
    await mkdir(brokenDirectory, { recursive: true });
    await writeFile(path.join(brokenDirectory, 'plugin.json'), '{not-json', 'utf8');

    const plugins = await listInstalledPlugins(tempRoot, '0.1.0');

    expect(plugins.map((plugin) => plugin.pluginId)).toEqual([
      'broken-plugin',
      'future-plugin',
      'lua',
      'lua-disabled',
    ]);
    expect(plugins.find((plugin) => plugin.pluginId === 'lua')?.status).toBe('loaded');
    expect(plugins.find((plugin) => plugin.pluginId === 'lua-disabled')?.status).toBe('disabled');
    expect(plugins.find((plugin) => plugin.pluginId === 'future-plugin')?.status).toBe(
      'incompatible'
    );
    expect(plugins.find((plugin) => plugin.pluginId === 'broken-plugin')?.status).toBe(
      'invalid'
    );
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
    expect(getPluginInstallDirectory()).toBe('/tmp/runlang-user-data/plugins');
  });
});
