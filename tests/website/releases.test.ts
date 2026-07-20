import { describe, expect, it } from 'vitest';

import {
  groupAssetsByPlatform,
  inferPlatformAndArch,
  downloadableAssets,
  type Release,
} from '../../website/src/lib/releases';

describe('website release asset classification', () => {
  it('classifies the electron-builder Windows NSIS installer as x64', () => {
    expect(inferPlatformAndArch('Lingua-0.14.0-win-x64.exe')).toEqual({
      platform: 'windows',
      arch: 'x64',
      format: 'exe',
    });
  });

  it('keeps macOS architectures separate from the Windows installer', () => {
    const names = [
      'Lingua-0.14.0-mac-arm64.dmg',
      'Lingua-0.14.0-mac-x64.dmg',
      'Lingua-0.14.0-win-x64.exe',
      'Lingua-0.14.0-linux-x86_64.AppImage',
    ];
    const release: Release = {
      tag: 'v0.14.0',
      version: '0.14.0',
      publishedAt: '2026-07-20T00:00:00.000Z',
      htmlUrl: '/changelog#v0.14.0',
      channel: 'stable',
      assets: names.map(name => ({
        name,
        downloadUrl: `https://github.test/${name}`,
        sizeBytes: 1,
        ...inferPlatformAndArch(name),
      })),
    };

    const grouped = groupAssetsByPlatform(release);
    expect(grouped.macos.map(asset => asset.arch)).toEqual(['arm64', 'x64']);
    expect(grouped.windows.map(asset => asset.name)).toEqual(['Lingua-0.14.0-win-x64.exe']);
    expect(grouped.linux).toHaveLength(1);
  });

  it('shows macOS dmg installers in native-first order and hides updater zips', () => {
    const names = [
      'Lingua-0.14.0-mac-x64.zip',
      'Lingua-0.14.0-mac-x64.dmg',
      'Lingua-0.14.0-mac-arm64.zip',
      'Lingua-0.14.0-mac-arm64.dmg',
    ];
    const assets = names.map(name => ({
      name,
      downloadUrl: `https://github.test/${name}`,
      sizeBytes: 1,
      ...inferPlatformAndArch(name),
    }));

    expect(downloadableAssets(assets).map(asset => asset.name)).toEqual([
      'Lingua-0.14.0-mac-arm64.dmg',
      'Lingua-0.14.0-mac-x64.dmg',
    ]);
  });
});
