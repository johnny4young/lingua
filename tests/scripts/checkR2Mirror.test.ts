// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { listGitHubReleaseAssets } from '../../scripts/check-r2-mirror.mjs';

describe('check-r2-mirror GitHub release lookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to the authenticated releases list for draft releases', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/releases/tags/v1.2.3')) {
        return new Response('', { status: 404 });
      }
      if (href.endsWith('/releases?per_page=100&page=1')) {
        return new Response(
          JSON.stringify([
            {
              tag_name: 'v1.2.3',
              draft: true,
              assets: [
                {
                  name: 'Lingua-darwin-arm64-1.2.3.zip',
                  size: 123,
                  url: 'https://api.github.com/assets/1',
                },
              ],
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('unexpected URL', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listGitHubReleaseAssets('owner/repo', 'v1.2.3', 'token')).resolves.toEqual([
      {
        name: 'Lingua-darwin-arm64-1.2.3.zip',
        size: 123,
        downloadUrl: 'https://api.github.com/assets/1',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
