import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import packageJson from '../../package.json' with { type: 'json' };
import releaseSnapshot from '../src/data/latest-release.json' with { type: 'json' };
import { filterChangelogThroughVersion, type ChangelogEntry } from '../src/lib/changelog.ts';
import {
  downloadableAssets,
  fetchLatestRelease,
  groupAssetsByPlatform,
  inferPlatformAndArch,
  type Release,
} from '../src/lib/releases.ts';
import {
  compareStableVersions,
  createReleaseSnapshot,
  parseGithubRelease,
  parseReleaseSnapshot,
} from '../src/lib/releaseSnapshot.ts';

const CANDIDATE_TAG = `v${packageJson.version}`;
const PUBLIC_TAG = releaseSnapshot.release.tag;

function asset(name: string, version = packageJson.version, size = 1024) {
  const tag = `v${version}`;
  return {
    name,
    browser_download_url: `https://github.com/johnny4young/lingua/releases/download/${tag}/${encodeURIComponent(name)}`,
    size,
  };
}

function githubRelease(version = packageJson.version) {
  const tag = `v${version}`;
  return {
    tag_name: tag,
    published_at: '2026-07-28T21:26:52Z',
    html_url: `https://github.com/johnny4young/lingua/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      asset(`Lingua-${version}-mac-arm64.dmg`, version),
      asset(`Lingua-${version}-mac-x64.dmg`, version),
      asset(`Lingua-${version}-win-x64.exe`, version),
      asset(`Lingua-${version}-linux-x86_64.AppImage`, version),
      asset('SHA256SUMS.txt', version),
    ],
  };
}

function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

describe('release asset classification', () => {
  it('classifies the electron-builder Windows NSIS installer as x64', () => {
    assert.deepEqual(inferPlatformAndArch('Lingua-0.14.0-win-x64.exe'), {
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
    assert.deepEqual(
      grouped.macos.map(candidate => candidate.arch),
      ['arm64', 'x64']
    );
    assert.deepEqual(
      grouped.windows.map(candidate => candidate.name),
      ['Lingua-0.14.0-win-x64.exe']
    );
    assert.equal(grouped.linux.length, 1);
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

    assert.deepEqual(
      downloadableAssets(assets).map(candidate => candidate.name),
      ['Lingua-0.14.0-mac-arm64.dmg', 'Lingua-0.14.0-mac-x64.dmg']
    );
  });
});

describe('release metadata trust boundary', () => {
  it('validates the committed snapshot against the repository version', () => {
    const release = parseReleaseSnapshot(releaseSnapshot, packageJson.version);

    assert.equal(release.tag, PUBLIC_TAG);
    assert.ok(release.assets.length >= 5);
    assert.ok(release.assets.some(candidate => candidate.name === 'SHA256SUMS.txt'));
  });

  it('normalizes a stable GitHub release into a snapshot', () => {
    const snapshot = createReleaseSnapshot(githubRelease(), '2026-08-01T20:00:00.000Z');

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.capturedAt, '2026-08-01T20:00:00.000Z');
    assert.equal(snapshot.release.tag, CANDIDATE_TAG);
    assert.equal(parseReleaseSnapshot(snapshot, packageJson.version).version, packageJson.version);
  });

  it('allows the last public release behind a source candidate but requires an exact release on promotion', () => {
    const snapshot = createReleaseSnapshot(githubRelease('0.15.0'), '2026-08-01T20:00:00.000Z');

    assert.equal(parseReleaseSnapshot(snapshot, '1.0.0').version, '0.15.0');
    assert.throws(
      () => parseReleaseSnapshot(snapshot, '1.0.0', { requireCurrentVersion: true }),
      /does not match repository version/u
    );
  });

  it('rejects a public release newer than the checked-out source', () => {
    const snapshot = createReleaseSnapshot(githubRelease('1.0.0'), '2026-08-01T20:00:00.000Z');

    assert.throws(() => parseReleaseSnapshot(snapshot, '0.15.0'), /is newer than/u);
    assert.throws(
      () => parseGithubRelease(githubRelease('1.0.0'), { repositoryVersion: '0.15.0' }),
      /is newer than/u
    );
  });

  it('orders stable versions numerically and hides candidate changelog entries', () => {
    assert.equal(compareStableVersions('0.15.0', '1.0.0'), -1);
    assert.equal(compareStableVersions('1.0.0', '1.0.0'), 0);
    assert.equal(compareStableVersions('10.0.0', '2.99.99'), 1);
    assert.throws(() => compareStableVersions('1.0', '1.0.0'), /stable X\.Y\.Z/u);

    const entries = ['1.0.0', '0.15.0', '0.14.0'].map(
      version =>
        ({
          version,
          date: '2026-08-02',
          sections: [],
          raw: '',
        }) satisfies ChangelogEntry
    );
    assert.deepEqual(
      filterChangelogThroughVersion(entries, '0.15.0').map(entry => entry.version),
      ['0.15.0', '0.14.0']
    );
  });

  it('rejects foreign downloads, duplicate assets, and incomplete releases', () => {
    const foreign = structuredClone(githubRelease());
    foreign.assets[0]!.browser_download_url = 'https://example.com/Lingua.dmg';
    assert.throws(() => parseGithubRelease(foreign), /canonical GitHub download URL/u);

    const duplicate = structuredClone(githubRelease());
    duplicate.assets.push(structuredClone(duplicate.assets[0]!));
    assert.throws(() => parseGithubRelease(duplicate), /duplicate asset/u);

    const noChecksums = structuredClone(githubRelease());
    noChecksums.assets = noChecksums.assets.filter(
      candidate => candidate.name !== 'SHA256SUMS.txt'
    );
    assert.throws(() => parseGithubRelease(noChecksums), /SHA256SUMS/u);

    const noWindows = structuredClone(githubRelease());
    noWindows.assets = noWindows.assets.filter(
      candidate => !candidate.name.endsWith('-win-x64.exe')
    );
    assert.throws(() => parseGithubRelease(noWindows), /missing supported desktop asset/u);
  });

  it('uses live trusted metadata when GitHub responds successfully', async () => {
    const release = await fetchLatestRelease({
      fetchImpl: fetchReturning(Response.json(githubRelease())),
      retryDelaysMs: [],
    });

    assert.equal(release?.tag, CANDIDATE_TAG);
    assert.deepEqual(
      release?.assets.map(candidate => candidate.name),
      [
        `Lingua-${packageJson.version}-mac-arm64.dmg`,
        `Lingua-${packageJson.version}-mac-x64.dmg`,
        `Lingua-${packageJson.version}-win-x64.exe`,
        `Lingua-${packageJson.version}-linux-x86_64.AppImage`,
        'SHA256SUMS.txt',
      ]
    );
  });

  for (const [label, implementation] of [
    ['network failure', async () => Promise.reject(new TypeError('offline'))],
    ['server failure', async () => new Response(null, { status: 503, statusText: 'Unavailable' })],
    [
      'rate limit',
      async () =>
        new Response(null, {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'x-ratelimit-remaining': '0' },
        }),
    ],
  ] as const) {
    it(`falls back to the validated snapshot on ${label}`, async () => {
      const warnings: string[] = [];
      const release = await fetchLatestRelease({
        fetchImpl: implementation as unknown as typeof fetch,
        retryDelaysMs: [],
        warn: message => warnings.push(message),
      });

      assert.equal(release?.tag, PUBLIC_TAG);
      assert.ok(release?.assets.some(candidate => candidate.name === 'SHA256SUMS.txt'));
      assert.match(
        warnings[0] ?? '',
        new RegExp(`snapshot for ${PUBLIC_TAG.replaceAll('.', '\\.')}\\b`, 'u')
      );
    });
  }

  it('fails closed for non-retryable responses and malformed successful payloads', async () => {
    const warnings: string[] = [];
    await assert.rejects(
      fetchLatestRelease({
        fetchImpl: fetchReturning(new Response(null, { status: 404, statusText: 'Not Found' })),
        retryDelaysMs: [],
        warn: message => warnings.push(message),
      }),
      /HTTP 404/u
    );
    assert.deepEqual(warnings, []);

    await assert.rejects(
      fetchLatestRelease({
        fetchImpl: fetchReturning(new Response('{', { status: 200 })),
        retryDelaysMs: [],
      }),
      /not valid JSON/u
    );

    const untrusted = githubRelease();
    untrusted.prerelease = true;
    await assert.rejects(
      fetchLatestRelease({
        fetchImpl: fetchReturning(Response.json(untrusted)),
        retryDelaysMs: [],
      }),
      /prerelease/u
    );

    await assert.rejects(
      fetchLatestRelease({
        fetchImpl: fetchReturning(Response.json(githubRelease('2.0.0'))),
        retryDelaysMs: [],
      }),
      /is newer than repository version/u
    );
  });
});
