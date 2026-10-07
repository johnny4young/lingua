import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import releaseSnapshot from '../src/data/latest-release.json' with { type: 'json' };
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';
import * as releases from '../src/lib/releases.ts';
const { downloadableAssets, inferPlatformAndArch } = releases;

const asset = (name: string) => ({ name, downloadUrl: `https://example.test/${name}`, sizeBytes: 1024, ...inferPlatformAndArch(name) });

describe('download product choice', () => {
  it('distinguishes the published terminal archives from desktop installers', () => {
    for (const name of ['lingua-cli-v1.5.1-linux-x64.tar.gz', 'lingua-cli-v1.5.1-windows-x64.tar.gz', 'linguacode-cli-1.5.1.tgz']) {
      assert.equal(releases.inferReleaseProduct(name), 'cli');
    }
    for (const name of ['Lingua-1.5.1-mac-arm64.dmg', 'Lingua-1.5.1-win-x64.exe', 'Lingua-1.5.1-linux-x86_64.AppImage']) {
      assert.equal(releases.inferReleaseProduct(name), 'desktop');
    }
    assert.equal(releases.inferReleaseProduct('future-tool-windows-x64.zip'), 'other');
  });
  it('honors an explicit platform before the legacy bare zip fallback', () => {
    assert.equal(inferPlatformAndArch('lingua-cli-v1.5.1-windows-x64.zip').platform, 'windows');
    assert.equal(inferPlatformAndArch('Lingua-1.5.1-win-x64.zip').platform, 'windows');
    assert.equal(inferPlatformAndArch('lingua-cli-v1.5.1-linux-arm64.zip').platform, 'linux');
    assert.equal(inferPlatformAndArch('Lingua-1.5.1-x64.zip').platform, 'macos');
  });
  it('keeps a terminal zip when the same architecture has a desktop DMG', () => {
    const names = ['Lingua-1.5.1-mac-arm64.dmg', 'Lingua-1.5.1-mac-arm64.zip', 'lingua-cli-v1.5.1-macos-arm64.zip'];
    assert.deepEqual(downloadableAssets(names.map(asset)).map(a => a.name), [names[0], names[2]]);
  });
  it('retains explicit Windows and Linux ZIPs beside a same-architecture macOS DMG', () => {
    const names = ['Lingua-1.5.1-mac-x64.dmg', 'Lingua-1.5.1-windows-x64.zip', 'Lingua-1.5.1-linux-x64.zip'];
    assert.deepEqual(new Set(downloadableAssets(names.map(asset)).map(a => a.name)), new Set(names));
    assert.deepEqual(names.map(name => inferPlatformAndArch(name).platform), ['macos', 'windows', 'linux']);
  });
  it('classifies published snapshot products without using the candidate package version', () => {
    const published = releaseSnapshot.release.assets.map(a => ({ ...a, ...inferPlatformAndArch(a.name) }));
    for (const platform of ['macos', 'windows', 'linux'] as const) {
      const products = downloadableAssets(published.filter(a => a.platform === platform))
        .filter(a => !/\.(?:blockmap|yml)$/.test(a.name)).map(a => releases.inferReleaseProduct(a.name));
      assert(products.includes('desktop'));
      assert.equal(products.includes('cli'), platform !== 'macos');
    }
    for (const copy of [en.releases.downloadMatrix, es.releases.downloadMatrix]) {
      assert.notEqual(copy.products.desktop.title, copy.products.cli.title);
      assert.match(copy.products.cli.description, /Node\.js 24\.x/);
      assert(copy.platformNotes.windows.length > 0);
      assert(copy.verifySummary.length > 0);
    }
  });

});
