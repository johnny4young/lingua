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
  published_at: string;
  assets: ReleaseAsset[];
}

/** Fetch the latest published (non-draft, non-prerelease) release. */
export async function getLatestRelease(token: string): Promise<Release | null> {
  const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/releases`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lingua-update-server/1.0',
    },
  });

  if (!res.ok) return null;

  const releases: Release[] = await res.json();
  return releases.find((r) => !r.draft && !r.prerelease) ?? null;
}

/**
 * Resolve a private-repo asset to a time-limited signed download URL.
 *
 * GitHub returns a 302 redirect to an S3 signed URL when we request
 * an asset with `Accept: application/octet-stream`. We capture the
 * Location header without following the redirect.
 */
export async function getAssetDownloadURL(
  token: string,
  assetId: number,
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${OWNER}/${REPO}/releases/assets/${assetId}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/octet-stream',
        'User-Agent': 'lingua-update-server/1.0',
      },
      redirect: 'manual',
    },
  );

  if (res.status === 302) {
    return res.headers.get('Location');
  }
  return null;
}

/**
 * Download raw text content of a private-repo asset (used for RELEASES file).
 */
export async function getAssetContent(
  token: string,
  assetId: number,
): Promise<string | null> {
  const url = await getAssetDownloadURL(token, assetId);
  if (!url) return null;

  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}
