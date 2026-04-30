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
