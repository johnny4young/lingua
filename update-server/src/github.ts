const GITHUB_API = 'https://api.github.com';
const OWNER = 'johnny4young';
const REPO = 'lingua';

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

export interface Release {
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at?: string;
  assets: ReleaseAsset[];
}

export type ReleaseChannel = 'stable' | 'draft';

export function pickLatestRelease(
  releases: Release[],
  channel: ReleaseChannel = 'stable'
): Release | null {
  if (channel === 'draft') {
    return releases.find(r => r.draft && !r.prerelease) ?? null;
  }
  return releases.find(r => !r.draft && !r.prerelease) ?? null;
}

/** Fetch the latest release for the requested update channel.
 *
 * `cf.cacheTtl` caps the Cloudflare Workers edge cache for this
 * specific fetch at 60 seconds, regardless of what `Cache-Control`
 * GitHub sends back. Without this cap, Cloudflare honours GitHub's
 * own caching hints + its own heuristics, which observed in practice
 * means a release that flipped from draft to published can stay
 * invisible to the worker for tens of minutes (the symptom that
 * required the v0.4.0 asset rename + cache purge). 60 seconds is
 * the conservative ceiling: aligned with GitHub's typical
 * `Cache-Control: private, max-age=60` on the listing endpoint and
 * fast enough that a new release surfaces within the next post-
 * promote `check:update-feed` poll. The shorter cap also reduces
 * the chance of post-publish smoke seeing the stale snapshot.
 */
export async function getLatestRelease(
  token: string,
  channel: ReleaseChannel = 'stable'
): Promise<Release | null> {
  const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/releases`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lingua-update-server/1.0',
    },
    cf: { cacheTtl: 60, cacheEverything: true },
  });

  if (!res.ok) return null;

  const releases: Release[] = await res.json();
  return pickLatestRelease(releases, channel);
}

/**
 * Resolve a private-repo asset to a time-limited signed download URL.
 *
 * GitHub returns a 302 redirect to an S3 signed URL when we request
 * an asset with `Accept: application/octet-stream`. We capture the
 * Location header without following the redirect.
 */
export async function getAssetDownloadURL(token: string, assetId: number): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/releases/assets/${assetId}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'lingua-update-server/1.0',
    },
    redirect: 'manual',
  });

  if (res.status === 302) {
    return res.headers.get('Location');
  }
  return null;
}

/**
 * Download raw text content of a private-repo asset (used for RELEASES file).
 */
export async function getAssetContent(token: string, assetId: number): Promise<string | null> {
  const url = await getAssetDownloadURL(token, assetId);
  if (!url) return null;

  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}
