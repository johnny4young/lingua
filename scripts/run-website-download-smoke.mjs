#!/usr/bin/env node
// CI-only qualification of synthetic download metadata. No assets are downloaded.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Deliberately unrelated to a real release. All platforms contain both products,
// including macOS CLI archives even when the public snapshot has none.
export const websiteDownloadFixture = {
  schemaVersion: 1,
  capturedAt: '2026-01-01T00:00:00.000Z',
  release: {
    tag: 'v0.0.0',
    publishedAt: '2026-01-01T00:00:00.000Z',
    htmlUrl: 'https://github.com/johnny4young/lingua/releases/tag/v0.0.0',
    draft: false,
    prerelease: false,
    assets: [
      'Lingua-0.0.0-mac-arm64.dmg',
      'Lingua-0.0.0-mac-x64.dmg',
      'Lingua-0.0.0-win-x64.exe',
      'Lingua-0.0.0-linux-x86_64.AppImage',
      'lingua-cli-v0.0.0-darwin-arm64.zip',
      'lingua-cli-v0.0.0-darwin-x64.zip',
      'lingua-cli-v0.0.0-windows-x64.zip',
      'lingua-cli-v0.0.0-linux-x64.zip',
      'SHA256SUMS.txt',
      // Sidecars must not appear as product downloads.
      'latest.yml',
      'Lingua-0.0.0-win-x64.exe.blockmap',
      'lingua-sbom.cyclonedx.json',
      'THIRD_PARTY_LICENSE_REPORT.md',
    ].map(name => ({
      name,
      downloadUrl: `https://github.com/johnny4young/lingua/releases/download/v0.0.0/${name}`,
      sizeBytes: name.startsWith('Lingua-') ? 104857600 : 1048576,
    })),
  },
};

/** @param {NodeJS.ProcessEnv} [env] */
export function assertHostedWebsiteSmoke(env = process.env) {
  assert.ok(
    env.GITHUB_ACTIONS === 'true' && (env.CI === 'true' || env.CI === '1'),
    'Website browser smoke is restricted to GitHub Actions; local browser execution is not enabled.'
  );
}

/**
 * The build uses the existing offline loader and all its validation. Restore
 * exact bytes even on build failure, before starting any preview server.
 * @param {string} snapshotPath
 * @param {() => void} build
 */
export function withWebsiteDownloadFixture(snapshotPath, build) {
  const original = readFileSync(snapshotPath);
  try {
    writeFileSync(snapshotPath, `${JSON.stringify(websiteDownloadFixture, null, 2)}\n`);
    build();
  } finally {
    writeFileSync(snapshotPath, original);
    assert.deepEqual(
      readFileSync(snapshotPath),
      original,
      'Release snapshot restoration changed bytes'
    );
  }
}

/** @param {string} command @param {string[]} args @param {number} timeout */
function run(command, args, timeout) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    timeout,
    env: {
      ...process.env,
      LINGUA_SOURCE: 'local',
      ASTRO_TELEMETRY_DISABLED: '1',
      PUBLIC_CF_ANALYTICS_TOKEN: '',
      PLAYWRIGHT_BROWSERS_PATH: '0',
    },
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed (${result.signal ?? result.status})`
  );
}

function main() {
  assertHostedWebsiteSmoke();
  assert.equal(
    process.argv.length,
    2,
    'Website smoke does not accept command or destination overrides'
  );
  rmSync(path.join(root, 'output/playwright/website-downloads'), { recursive: true, force: true });
  const snapshotPath = path.join(root, 'website/src/data/latest-release.json');
  const snapshotHash = () => createHash('sha256').update(readFileSync(snapshotPath)).digest('hex');
  try {
    console.log(`Release snapshot SHA-256 before fixture build: ${snapshotHash()}`);
    try {
      withWebsiteDownloadFixture(snapshotPath, () => {
        run('npm', ['--prefix', 'website', 'run', 'build'], 180_000);
      });
    } finally {
      console.log(`Release snapshot SHA-256 after fixture build: ${snapshotHash()}`);
    }
    run(
      process.execPath,
      [
        path.join(root, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        'playwright.website-downloads.config.mts',
      ],
      180_000
    );
  } finally {
    // Synthetic output must never remain available to a later publishing step.
    rmSync(path.join(root, 'website/dist'), { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
