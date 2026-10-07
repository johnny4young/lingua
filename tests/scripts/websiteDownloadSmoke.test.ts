import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  assertHostedWebsiteSmoke,
  websiteDownloadFixture,
  withWebsiteDownloadFixture,
} from '../../scripts/run-website-download-smoke.mjs';
import {
  downloadableAssets,
  inferPlatformAndArch,
  inferReleaseProduct,
} from '../../website/src/lib/releases.ts';
import { parseReleaseSnapshot } from '../../website/src/lib/releaseSnapshot.ts';

const root = path.resolve(__dirname, '../..');

describe('website download browser qualification controls', () => {
  it.each([
    {},
    { CI: 'true' },
    { GITHUB_ACTIONS: 'true' },
    { CI: 'false', GITHUB_ACTIONS: 'true' },
  ])('refuses non-hosted execution: %j', env =>
    expect(() => assertHostedWebsiteSmoke(env)).toThrow('restricted to GitHub Actions')
  );

  it('recognizes the hosted CI environment without starting a browser', () => {
    expect(() => assertHostedWebsiteSmoke({ CI: 'true', GITHUB_ACTIONS: 'true' })).not.toThrow();
    expect(() => assertHostedWebsiteSmoke({ CI: '1', GITHUB_ACTIONS: 'true' })).not.toThrow();
  });

  it('qualifies a synthetic release through the unchanged production validator', () => {
    const release = parseReleaseSnapshot(websiteDownloadFixture, '1.0.0');
    expect(release.version).toBe('0.0.0');
    const products = release.assets.filter(asset =>
      ['desktop', 'cli'].includes(inferReleaseProduct(asset.name))
    );
    for (const platform of ['macos', 'windows', 'linux']) {
      const owned = products.filter(
        asset => inferPlatformAndArch(asset.name).platform === platform
      );
      expect(new Set(owned.map(asset => inferReleaseProduct(asset.name)))).toEqual(
        new Set(['desktop', 'cli'])
      );
      expect(owned).toHaveLength(platform === 'macos' ? 4 : 2);
    }
    expect(products).toHaveLength(8);
    expect(
      products
        .filter(asset => inferReleaseProduct(asset.name) === 'cli')
        .every(asset => asset.name.endsWith('.zip'))
    ).toBe(true);
    expect(
      downloadableAssets(products.map(asset => ({ ...asset, ...inferPlatformAndArch(asset.name) })))
    ).toHaveLength(8);
    expect(release.assets.map(asset => asset.name)).toContain('SHA256SUMS.txt');
    const foreign = structuredClone(websiteDownloadFixture);
    foreign.release.assets[0]!.downloadUrl = 'https://untrusted.example/installer.dmg';
    expect(() => parseReleaseSnapshot(foreign, '1.0.0')).toThrow('canonical GitHub download URL');
  });

  it.each([false, true])(
    'restores exact original snapshot bytes when build failure is %s',
    fails => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'lingua-website-snapshot-'));
      const snapshot = path.join(directory, 'latest-release.json');
      const original = Buffer.from('{\r\n  "original": "é漢😀"\r\n}\r\n');
      writeFileSync(snapshot, original);
      let builds = 0;
      const build = () =>
        withWebsiteDownloadFixture(snapshot, () => {
          builds += 1;
          expect(JSON.parse(readFileSync(snapshot, 'utf8'))).toEqual(websiteDownloadFixture);
          if (fails) throw new Error('synthetic build failure');
        });
      try {
        if (fails) expect(build).toThrow('synthetic build failure');
        else build();
        expect(builds).toBe(1);
        expect(readFileSync(snapshot)).toEqual(original);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it('fails before a build if the original snapshot cannot be preserved', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'lingua-website-snapshot-'));
    let built = false;
    try {
      expect(() =>
        withWebsiteDownloadFixture(path.join(directory, 'missing.json'), () => {
          built = true;
        })
      ).toThrow();
      expect(built).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retains only four named PNGs for seven days in an isolated artifact', () => {
    const workflow = load(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')) as {
      jobs: Record<
        string,
        {
          steps: Array<{
            name?: string;
            run?: string;
            if?: string;
            'working-directory'?: string;
            env?: Record<string, string>;
            with?: Record<string, unknown>;
          }>;
        }
      >;
    };
    const steps = workflow.jobs['desktop-bundles']!.steps;
    const macPullRequest = "matrix.os == 'macos-latest' && github.event_name == 'pull_request'";
    const dependencies = steps.find(step => step.name === 'Install website smoke dependencies');
    expect(dependencies?.run).toBe('npm ci --no-audit --no-fund');
    expect(dependencies?.['working-directory']).toBe('website');
    expect(dependencies?.if).toBe(macPullRequest);
    const chromium = steps.find(step => step.name === 'Install website smoke Chromium');
    expect(chromium?.run).toBe('pnpm exec playwright install chromium');
    expect(chromium?.env?.PLAYWRIGHT_BROWSERS_PATH).toBe('0');
    expect(chromium?.if).toBe(macPullRequest);
    const smoke = steps.find(step => step.name === 'Website download browser smoke');
    expect(smoke?.run).toBe('node scripts/run-website-download-smoke.mjs');
    expect(smoke?.if).toBe(macPullRequest);
    const subprojects = workflow.jobs.subprojects!.steps;
    expect(subprojects.find(step => step.name === 'Website download smoke types')?.run).toBe(
      'pnpm exec tsc --noEmit -p tsconfig.website-downloads.json'
    );
    expect(subprojects.some(step => step.name === 'Website download browser smoke')).toBe(false);
    expect(subprojects.some(step => step.name === 'Install website smoke Chromium')).toBe(false);
    const upload = steps.find(step => step.name === 'Upload website download evidence');
    expect(upload?.if).toBe(
      `always() && ${macPullRequest} && steps.website-download-smoke.outcome != 'skipped'`
    );
    expect(upload?.with?.name).toBe('website-download-matrix');
    expect(upload?.with?.['retention-days']).toBe(7);
    expect(upload?.with?.['if-no-files-found']).toBe('error');
    expect(String(upload?.with?.path).trim().split('\n')).toEqual([
      'output/playwright/website-downloads/en-desktop.png',
      'output/playwright/website-downloads/es-desktop.png',
      'output/playwright/website-downloads/en-mobile.png',
      'output/playwright/website-downloads/es-mobile.png',
    ]);
    const native = steps.find(step => step.name === 'Native Unicode capture and Stop smoke');
    expect(native?.run).toBe('node scripts/smoke-native-output.mjs');
    expect(native?.if).toBe(macPullRequest);
    expect(steps.indexOf(native!)).toBeLessThan(steps.indexOf(dependencies!));
  });

  it('keeps browser capture explicit and preserves sandbox and server isolation', () => {
    const config = readFileSync(path.join(root, 'playwright.website-downloads.config.mts'), 'utf8');
    expect(config).toContain('assertHostedWebsiteSmoke()');
    expect(config).toContain('chromiumSandbox: true');
    expect(config).toContain('reuseExistingServer: false');
    expect(config).toContain('acceptDownloads: false');
    expect(config).toContain("trace: 'off'");
    expect(config).toContain("screenshot: 'off'");
    expect(config).toContain("video: 'off'");
    expect(config).not.toMatch(/--no-sandbox|ignoreHTTPSErrors|bypassCSP/);
    const runner = readFileSync(path.join(root, 'scripts/run-website-download-smoke.mjs'), 'utf8');
    expect(runner).toContain("LINGUA_SOURCE: 'local'");
    expect(runner).toContain("PUBLIC_CF_ANALYTICS_TOKEN: ''");
    expect(runner).toContain("rmSync(path.join(root, 'website/dist')");
  });
});
