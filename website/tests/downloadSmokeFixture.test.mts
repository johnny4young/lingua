import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { websiteDownloadFixture } from '../../scripts/run-website-download-smoke.mjs';
import {
  downloadableAssets,
  inferPlatformAndArch,
  inferReleaseProduct,
} from '../src/lib/releases.ts';
import { parseReleaseSnapshot } from '../src/lib/releaseSnapshot.ts';

// Production website imports belong to this independently installed package.
// Root-only jobs retain the fixture lifecycle and workflow controls separately.
describe('website download browser qualification fixture', () => {
  it('qualifies a synthetic release through the unchanged production validator', () => {
    const release = parseReleaseSnapshot(websiteDownloadFixture, '1.0.0');
    assert.equal(release.version, '0.0.0');
    const products = release.assets.filter(asset =>
      ['desktop', 'cli'].includes(inferReleaseProduct(asset.name))
    );
    for (const platform of ['macos', 'windows', 'linux']) {
      const owned = products.filter(
        asset => inferPlatformAndArch(asset.name).platform === platform
      );
      assert.deepEqual(
        new Set(owned.map(asset => inferReleaseProduct(asset.name))),
        new Set(['desktop', 'cli'])
      );
      assert.equal(owned.length, platform === 'macos' ? 4 : 2);
    }
    assert.equal(products.length, 8);
    assert.equal(
      products
        .filter(asset => inferReleaseProduct(asset.name) === 'cli')
        .every(asset => asset.name.endsWith('.zip')),
      true
    );
    assert.equal(
      downloadableAssets(products.map(asset => ({ ...asset, ...inferPlatformAndArch(asset.name) })))
        .length,
      8
    );
    assert.ok(release.assets.map(asset => asset.name).includes('SHA256SUMS.txt'));
    const foreign = structuredClone(websiteDownloadFixture);
    foreign.release.assets[0]!.downloadUrl = 'https://untrusted.example/installer.dmg';
    assert.throws(() => parseReleaseSnapshot(foreign, '1.0.0'), /canonical GitHub download URL/);
  });
});
