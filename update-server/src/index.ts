import { getLatestRelease, getAssetDownloadURL, getAssetContent } from './github';
import { isNewer } from './version';

export interface Env {
  GITHUB_TOKEN: string;
}

const CACHE_TTL = 300; // 5 minutes

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/') {
      return json({ status: 'ok', server: 'lingua-update-server' });
    }

    // GET /update/:platform/:version
    const updateMatch = path.match(/^\/update\/(darwin|win32)\/(.+)$/);
    if (updateMatch) {
      return handleUpdate(request, env, updateMatch[1], updateMatch[2]);
    }

    // GET /download/:assetId — proxy for Windows nupkg downloads
    const downloadMatch = path.match(/^\/download\/(\d+)$/);
    if (downloadMatch) {
      return handleDownload(env, parseInt(downloadMatch[1], 10));
    }

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleUpdate(
  request: Request,
  env: Env,
  platform: string,
  currentVersion: string,
): Promise<Response> {
  // Try to serve from cache first
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const release = await getLatestRelease(env.GITHUB_TOKEN);
  if (!release) {
    return new Response(null, { status: 204 });
  }

  if (!isNewer(release.tag_name, currentVersion)) {
    const noUpdate = new Response(null, {
      status: 204,
      headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` },
    });
    await cache.put(cacheKey, noUpdate.clone());
    return noUpdate;
  }

  let response: Response;
  if (platform === 'darwin') {
    response = await buildDarwinResponse(env, release, request.url);
  } else {
    response = await buildWin32Response(env, release, request.url);
  }

  if (response.status === 200) {
    const toCache = response.clone();
    // Attach cache headers for Cloudflare edge
    const withHeaders = new Response(toCache.body, {
      status: toCache.status,
      headers: {
        ...Object.fromEntries(toCache.headers),
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
      },
    });
    await cache.put(cacheKey, withHeaders.clone());
    return withHeaders;
  }

  return response;
}

async function handleDownload(env: Env, assetId: number): Promise<Response> {
  const downloadURL = await getAssetDownloadURL(env.GITHUB_TOKEN, assetId);
  if (!downloadURL) {
    return new Response('Asset not found', { status: 404 });
  }
  // Redirect to the time-limited signed S3 URL
  return Response.redirect(downloadURL, 302);
}

// ---------------------------------------------------------------------------
// Platform-specific response builders
// ---------------------------------------------------------------------------

async function buildDarwinResponse(
  env: Env,
  release: Awaited<ReturnType<typeof getLatestRelease>> & object,
  _requestUrl: string,
): Promise<Response> {
  // Find the macOS .zip asset
  const zipAsset = release.assets.find(
    (a) => a.name.includes('darwin') && a.name.endsWith('.zip'),
  );

  if (!zipAsset) {
    return new Response(null, { status: 204 });
  }

  // Resolve to a signed download URL (private repo)
  const downloadURL = await getAssetDownloadURL(env.GITHUB_TOKEN, zipAsset.id);
  if (!downloadURL) {
    return new Response('Failed to resolve asset URL', { status: 502 });
  }

  // Squirrel.Mac expects this JSON shape
  return json({
    url: downloadURL,
    name: release.name || release.tag_name,
    notes: release.body || '',
    pub_date: release.published_at,
  });
}

async function buildWin32Response(
  env: Env,
  release: Awaited<ReturnType<typeof getLatestRelease>> & object,
  requestUrl: string,
): Promise<Response> {
  // Find the RELEASES file asset
  const releasesAsset = release.assets.find((a) => a.name === 'RELEASES');
  if (!releasesAsset) {
    return new Response(null, { status: 204 });
  }

  // Download the RELEASES file content
  const releasesContent = await getAssetContent(
    env.GITHUB_TOKEN,
    releasesAsset.id,
  );
  if (!releasesContent) {
    return new Response('Failed to fetch RELEASES', { status: 502 });
  }

  // Rewrite nupkg filenames to point through our /download/ proxy
  // RELEASES format: "SHA1 filename SIZE"
  const baseUrl = new URL(requestUrl).origin;
  const rewritten = releasesContent
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return trimmed;
      // Find the nupkg asset by filename and rewrite to our proxy URL
      const parts = trimmed.split(' ');
      if (parts.length >= 2) {
        const filename = parts[1];
        const nupkgAsset = release.assets.find((a) => a.name === filename);
        if (nupkgAsset) {
          parts[1] = `${baseUrl}/download/${nupkgAsset.id}`;
        }
      }
      return parts.join(' ');
    })
    .join('\n');

  return new Response(rewritten, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
