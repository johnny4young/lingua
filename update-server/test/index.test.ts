/**
 * RL-061 Slice 5 — `/web/version` endpoint tests.
 *
 * Covers the four cases the renderer's `useWebVersionPolling` hook
 * relies on:
 *   1. Happy path: returns `{ version: "0.2.1" }` (tag with the
 *      leading `v` stripped) plus the standard 5-minute cache header.
 *   2. Cache: a second hit returns the cached response without
 *      calling the GitHub API again.
 *   3. No releases: returns 204 (no body) so the renderer treats it
 *      as "nothing to compare against" and skips the banner.
 *   4. Cache-Control header is set on both happy + 204 branches so
 *      CF edge caches the response uniformly.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import worker, { type Env } from '../src/index';
import { isNewer, parseVersion } from '../src/version';

type FetchMock = Mock<typeof fetch>;

// In-memory replacement for `caches.default`. Just enough to pin the
// cache-hit / cache-miss contract — does NOT honour Cache-Control TTL
// (vitest tests are synchronous so TTL doesn't matter in this scope).
function createMockCacheStorage(): { mockCache: Cache; store: Map<string, Response> } {
  const store = new Map<string, Response>();
  const mockCache: Cache = {
    match: vi.fn(async (request: RequestInfo | URL) => {
      const key = typeof request === 'string' ? request : (request as Request).url;
      const cached = store.get(key);
      return cached ? cached.clone() : undefined;
    }),
    put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
      const key = typeof request === 'string' ? request : (request as Request).url;
      store.set(key, response.clone());
    }),
    add: vi.fn(),
    addAll: vi.fn(),
    delete: vi.fn(),
    keys: vi.fn(),
    matchAll: vi.fn(),
  } as unknown as Cache;
  return { mockCache, store };
}

function createEnv(): Env {
  return { GITHUB_TOKEN: 'gh_test_token' };
}

function createGitHubReleaseResponse(tag: string | null): Response {
  if (tag === null) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const release = {
    tag_name: tag,
    name: `Release ${tag}`,
    body: 'Release notes',
    draft: false,
    prerelease: false,
    published_at: '2026-04-30T00:00:00Z',
    assets: [],
  };
  return new Response(JSON.stringify([release]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// RL-080 Slice 1 — `/update/:platform/:version` test fixtures
// ---------------------------------------------------------------------------

interface FixtureAsset {
  id: number;
  name: string;
  /**
   * The URL that getAssetDownloadURL should resolve this asset to (the
   * 302 Location). Skip to make the redirect step fail (returns null).
   */
  downloadUrl?: string;
  /** Body served when the signed download URL is fetched (win32 RELEASES). */
  content?: string;
  /**
   * Force the signed-URL fetch to fail (used to drive the
   * "RELEASES download fails" 502 branch).
   */
  contentFails?: boolean;
}

interface UpdateFixture {
  /** Set null to model "no released versions yet". */
  release: { tag: string; assets: FixtureAsset[] } | null;
}

function createReleaseListBody(release: UpdateFixture['release']): string {
  if (release === null) {
    return JSON.stringify([]);
  }
  return JSON.stringify([
    {
      tag_name: release.tag,
      name: `Release ${release.tag}`,
      body: `Notes for ${release.tag}`,
      draft: false,
      prerelease: false,
      published_at: '2026-05-04T00:00:00Z',
      assets: release.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        size: 1,
        browser_download_url: `https://github.com/example/${asset.name}`,
        content_type: 'application/octet-stream',
      })),
    },
  ]);
}

/**
 * Routes a single `globalThis.fetch` mock across the three GitHub
 * surfaces the update handler touches:
 *
 *   1. List releases — `getLatestRelease`.
 *   2. Resolve an asset id to a signed S3 URL (302 redirect) —
 *      `getAssetDownloadURL`.
 *   3. Download the resolved URL (win32 RELEASES content) —
 *      `getAssetContent`.
 *
 * Anything outside those three patterns throws so a stray request
 * surfaces as a hard test failure.
 */
function buildUpdateFetchMock(fixture: UpdateFixture): FetchMock {
  const mock: FetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const requestUrl = typeof input === 'string' ? input : (input as Request | URL).toString();

    if (requestUrl.endsWith('/repos/johnny4young/lingua/releases')) {
      return new Response(createReleaseListBody(fixture.release), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const assetMatch = requestUrl.match(
      /\/repos\/johnny4young\/lingua\/releases\/assets\/(\d+)$/u,
    );
    if (assetMatch) {
      const id = Number.parseInt(assetMatch[1]!, 10);
      const asset = fixture.release?.assets.find((a) => a.id === id);
      if (asset?.downloadUrl) {
        return new Response(null, {
          status: 302,
          headers: { Location: asset.downloadUrl },
        });
      }
      // Simulate the "could not resolve asset" branch — handler maps
      // the missing 302 to a 502 for win32 or to a 502 for darwin.
      return new Response('Not Found', { status: 404 });
    }

    // The signed-S3 URL fetch — the second hop inside getAssetContent.
    if (fixture.release) {
      const asset = fixture.release.assets.find((a) => a.downloadUrl === requestUrl);
      if (asset) {
        if (asset.contentFails) {
          return new Response('Forbidden', { status: 403 });
        }
        return new Response(asset.content ?? '', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
    }

    throw new Error(`Unexpected fetch in test: ${requestUrl}`);
  }) as FetchMock;
  return mock;
}

beforeEach(() => {
  // Each test installs its own mocks via vi.stubGlobal — clear here so
  // the previous test's stubs do not leak.
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /web/version', () => {
  it('returns the latest tag with the leading `v` stripped', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createGitHubReleaseResponse('v0.2.1')) as FetchMock,
    );

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/web/version'),
      createEnv(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { version: string };
    expect(body).toEqual({ version: '0.2.1' });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('does not call the GitHub API a second time when the cache is warm', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    const fetchMock = vi.fn().mockResolvedValue(createGitHubReleaseResponse('v0.3.0')) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const env = createEnv();
    await worker.fetch(new Request('https://updates.linguacode.dev/web/version'), env);
    await worker.fetch(new Request('https://updates.linguacode.dev/web/version'), env);

    // First request hits GitHub once. Second request should hit the
    // cache only — no additional GitHub API call. (The single fetch
    // call is the one that loaded the release into cache.)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns 204 (no body) when there are no published releases yet', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createGitHubReleaseResponse(null)) as FetchMock,
    );

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/web/version'),
      createEnv(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('handles tags without a leading v (defensive: unusual GH release naming)', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createGitHubReleaseResponse('1.0.0')) as FetchMock,
    );

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/web/version'),
      createEnv(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { version: string };
    // No leading `v` to strip — the tag passes through untouched.
    expect(body).toEqual({ version: '1.0.0' });
  });

  it('answers browser CORS preflight without touching GitHub', async () => {
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/web/version', { method: 'OPTIONS' }),
      createEnv(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /update/:platform/:version (RL-080 Slice 1)', () => {
  function callUpdate(platform: 'darwin' | 'win32', version: string) {
    return worker.fetch(
      new Request(`https://updates.linguacode.dev/update/${platform}/${version}`),
      createEnv(),
    );
  }

  it('returns 204 when there is no published release at all', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal('fetch', buildUpdateFetchMock({ release: null }));

    const response = await callUpdate('darwin', '0.2.0');

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('rejects non-GET update probes before touching GitHub', async () => {
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/update/darwin/0.2.0', {
        method: 'POST',
      }),
      createEnv(),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(await response.text()).toBe('Method Not Allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 204 with a cache header when the caller is already on the latest tag', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal(
      'fetch',
      buildUpdateFetchMock({
        release: {
          tag: 'v0.2.0',
          assets: [{ id: 1, name: 'lingua-0.2.0-darwin-x64.zip', downloadUrl: 'https://signed.example/zip' }],
        },
      }),
    );

    const response = await callUpdate('darwin', '0.2.0');

    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(await response.text()).toBe('');
  });

  it('returns the Squirrel.Mac JSON shape for darwin when a .zip asset is present', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    const fetchMock = buildUpdateFetchMock({
      release: {
        tag: 'v0.3.0',
        assets: [
          {
            id: 42,
            name: 'lingua-0.3.0-darwin-x64.zip',
            downloadUrl: 'https://signed.example/zip-42',
          },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await callUpdate('darwin', '0.2.0');

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      url: string;
      name: string;
      notes: string;
      pub_date: string;
    };
    expect(body.url).toBe('https://signed.example/zip-42');
    expect(body.name).toBe('Release v0.3.0');
    expect(body.notes).toBe('Notes for v0.3.0');
    expect(body.pub_date).toBe('2026-05-04T00:00:00Z');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');

    // Lock the redirect-mode contract on the asset-resolve leg. The
    // production handler must keep `redirect: 'manual'` so it can read
    // the 302 Location header; if a refactor swaps it for the default
    // `'follow'`, getAssetDownloadURL would return null and the
    // handler would silently degrade to 204/502.
    const assetCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/releases/assets/42'),
    );
    expect(assetCall, 'asset-resolve fetch was never issued').toBeDefined();
    expect(assetCall![1]).toMatchObject({ redirect: 'manual' });
  });

  it('returns 204 for darwin when the new release has no .zip darwin asset (missing-asset branch)', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal(
      'fetch',
      buildUpdateFetchMock({
        release: {
          tag: 'v0.3.0',
          assets: [
            // win32-only release: no darwin .zip in the asset list.
            {
              id: 7,
              name: 'lingua-0.3.0-win32-x64-setup.exe',
              downloadUrl: 'https://signed.example/exe',
            },
          ],
        },
      }),
    );

    const response = await callUpdate('darwin', '0.2.0');

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('rewrites RELEASES nupkg lines to /download/:id for win32', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal(
      'fetch',
      buildUpdateFetchMock({
        release: {
          tag: 'v0.3.0',
          assets: [
            {
              id: 99,
              name: 'RELEASES',
              downloadUrl: 'https://signed.example/releases',
              content:
                'ABCDEF1234 Lingua-0.3.0-full.nupkg 12345\n' +
                'GHIJKL5678 Lingua-0.3.0-delta.nupkg 678\n',
            },
            {
              id: 100,
              name: 'Lingua-0.3.0-full.nupkg',
              downloadUrl: 'https://signed.example/full.nupkg',
            },
            {
              id: 101,
              name: 'Lingua-0.3.0-delta.nupkg',
              downloadUrl: 'https://signed.example/delta.nupkg',
            },
          ],
        },
      }),
    );

    // Derive the expected origin from the same Request the handler
    // sees so the test does not break the moment the base URL changes.
    const baseOrigin = new URL(
      'https://updates.linguacode.dev/update/win32/0.2.0',
    ).origin;
    const response = await callUpdate('win32', '0.2.0');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/text\/plain/);
    const text = await response.text();
    // The handler walks each line and rewrites the second token (the
    // filename) to /download/:assetId, preserving the SHA1 and size.
    expect(text).toContain(`ABCDEF1234 ${baseOrigin}/download/100 12345`);
    expect(text).toContain(`GHIJKL5678 ${baseOrigin}/download/101 678`);
  });

  it('returns 204 for win32 when the RELEASES file is absent (missing-asset branch)', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal(
      'fetch',
      buildUpdateFetchMock({
        release: {
          tag: 'v0.3.0',
          assets: [
            // No `RELEASES` filename in the asset set.
            {
              id: 100,
              name: 'Lingua-0.3.0-full.nupkg',
              downloadUrl: 'https://signed.example/full.nupkg',
            },
          ],
        },
      }),
    );

    const response = await callUpdate('win32', '0.2.0');

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('returns 502 for win32 when the RELEASES asset content download fails', async () => {
    const { mockCache } = createMockCacheStorage();
    vi.stubGlobal('caches', { default: mockCache });
    vi.stubGlobal(
      'fetch',
      buildUpdateFetchMock({
        release: {
          tag: 'v0.3.0',
          assets: [
            {
              id: 99,
              name: 'RELEASES',
              downloadUrl: 'https://signed.example/releases-broken',
              contentFails: true,
            },
          ],
        },
      }),
    );

    const response = await callUpdate('win32', '0.2.0');

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Failed to fetch RELEASES');
  });
});

describe('GET /download/:assetId', () => {
  it('rejects non-GET download proxy requests before touching GitHub', async () => {
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://updates.linguacode.dev/download/42', {
        method: 'POST',
      }),
      createEnv(),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(await response.text()).toBe('Method Not Allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseVersion', () => {
  it.each([
    ['0.2.1', [0, 2, 1]],
    ['v0.2.1', [0, 2, 1]],
    ['10.20.30', [10, 20, 30]],
  ])('parses %s into a 3-tuple', (input, expected) => {
    expect(parseVersion(input)).toEqual(expected);
  });

  it.each([
    'invalid',
    '0.2',
    '0.2.',
    '01.2.3',
    '1e2.0.0',
    '0x1.0.0',
    '0.2.1.4',
    '',
    'v',
    '0.2.x',
    'v0.2.1-rc.1',
  ])('returns null for malformed: %s', (input) => {
    expect(parseVersion(input)).toBeNull();
  });
});

describe('isNewer', () => {
  it.each([
    ['0.2.1', '0.2.0', true],
    ['0.2.0', '0.2.0', false],
    ['0.2.0', '0.2.1', false],
    ['1.0.0', '0.99.99', true],
    ['v0.3.0', 'v0.2.999', true],
  ])('isNewer(%s, %s) === %s', (latest, current, expected) => {
    expect(isNewer(latest, current)).toBe(expected);
  });

  it('returns false when either side is malformed', () => {
    expect(isNewer('garbage', '0.2.0')).toBe(false);
    expect(isNewer('0.2.1', 'garbage')).toBe(false);
    expect(isNewer('garbage', 'garbage')).toBe(false);
  });
});
