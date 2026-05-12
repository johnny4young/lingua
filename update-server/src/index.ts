import {
  getLatestRelease,
  getAssetDownloadURL,
  getAssetContent,
  type Release,
  type ReleaseAsset,
  type ReleaseChannel,
} from './github';
import { isNewer } from './version';
import { log, wrapRequestObservability } from './lib/observability';
import {
  evaluateReadiness,
  resetReadinessProbeCacheForTests,
  SERVER_NAME,
  SERVER_VERSION,
} from './lib/health';
import { handleTelemetry } from './telemetry';

export interface Env {
  GITHUB_TOKEN: string;
  /**
   * Optional staging-only update channel. Production leaves this unset so the
   * updater only sees non-draft, non-prerelease GitHub Releases.
   */
  GITHUB_RELEASE_CHANNEL?: string;
}

const CACHE_TTL = 300; // 5 minutes
const WEB_VERSION_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function releaseVersion(release: Pick<Release, 'tag_name'>): string {
  return release.tag_name.replace(/^v/u, '');
}

function findDarwinZipAsset(release: Release): ReleaseAsset | undefined {
  const version = releaseVersion(release);
  const pattern = new RegExp(
    `^lingua-${escapeRegExp(version)}-darwin-(?:x64|arm64|universal)\\.zip$`,
    'iu'
  );
  return release.assets.find(asset => pattern.test(asset.name));
}

// Re-export so tests can clear the probe cache between cases without
// reaching into the lib path directly.
export { resetReadinessProbeCacheForTests, SERVER_NAME, SERVER_VERSION };

export function resolveReleaseChannel(env: Pick<Env, 'GITHUB_RELEASE_CHANNEL'>): ReleaseChannel {
  return env.GITHUB_RELEASE_CHANNEL === 'draft' ? 'draft' : 'stable';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return wrapRequestObservability(request, () => routeRequest(request, env));
  },
} satisfies ExportedHandler<Env>;

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Liveness check — root and /health both return the minimal payload.
  if (path === '/' || path === '/health') {
    if (request.method !== 'GET') {
      return methodNotAllowed();
    }
    return json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION });
  }

  // Readiness check — probes upstream GitHub reachability with a 30s
  // cache. RL-091 contract: always 200, the snapshot itself is the
  // signal so dashboards can read the dependencies map regardless.
  if (path === '/health/ready') {
    if (request.method !== 'GET') {
      return methodNotAllowed();
    }
    const snapshot = await evaluateReadiness(env);
    log('health.ready', {
      ok: snapshot.ok,
      degraded: snapshot.degraded,
    });
    return json({
      ok: snapshot.ok,
      server: SERVER_NAME,
      version: SERVER_VERSION,
      degraded: snapshot.degraded,
      dependencies: snapshot.dependencies,
    });
  }

  // GET /update/:platform/:version
  const updateMatch = path.match(/^\/update\/(darwin|win32)\/(.+)$/);
  if (updateMatch) {
    if (request.method !== 'GET') {
      return methodNotAllowed();
    }
    return handleUpdate(request, env, updateMatch[1], updateMatch[2]);
  }

  // GET /download/:assetId[/filename] — proxy for Windows nupkg downloads.
  // The optional filename keeps version evidence visible in RELEASES without
  // trusting the renderer/client to choose the asset id.
  const downloadMatch = path.match(/^\/download\/(\d+)(?:\/[^/]+)?$/);
  if (downloadMatch) {
    if (request.method !== 'GET') {
      return methodNotAllowed();
    }
    return handleDownload(env, parseInt(downloadMatch[1], 10));
  }

  // GET /web/version — RL-061 Slice 5
  // Returns the latest published GitHub release tag so the web build's
  // update banner can compare against its build-time pin. Cached for
  // 5 minutes at the edge to absorb spikes from many concurrent tabs
  // polling on the same cadence. Returns 204 (no body) when no
  // release exists yet so the renderer's null-fallback stays clean.
  if (path === '/web/version' && request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: WEB_VERSION_CORS_HEADERS });
  }
  if (path === '/web/version') {
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { ...WEB_VERSION_CORS_HEADERS, Allow: 'GET, OPTIONS' },
      });
    }
    return handleWebVersion(request, env);
  }

  // RL-065 Slice 5 — telemetry export endpoint. Method negotiation,
  // CORS preflight, payload guard, rate limit, allowlist, and
  // persistence all live inside `handleTelemetry`. The renderer
  // POSTs here from `src/renderer/utils/telemetry.ts` only after the
  // user has granted consent in Settings → Privacy.
  if (path === '/telemetry') {
    return handleTelemetry(request);
  }

  return new Response('Not Found', { status: 404 });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleUpdate(
  request: Request,
  env: Env,
  platform: string,
  currentVersion: string
): Promise<Response> {
  const releaseChannel = resolveReleaseChannel(env);
  const canUseCache = releaseChannel === 'stable';

  // Try to serve from cache first
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  if (canUseCache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const release = await getLatestRelease(env.GITHUB_TOKEN, releaseChannel);
  if (!release) {
    return new Response(null, { status: 204 });
  }

  if (!isNewer(release.tag_name, currentVersion)) {
    const noUpdate = new Response(null, {
      status: 204,
      headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` },
    });
    if (canUseCache) {
      await cache.put(cacheKey, noUpdate.clone());
    }
    return noUpdate;
  }

  let response: Response;
  if (platform === 'darwin') {
    response = await buildDarwinResponse(env, release, request.url);
  } else {
    response = await buildWin32Response(env, release, request.url);
  }

  if (response.status === 200 && canUseCache) {
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
  release: Release,
  _requestUrl: string
): Promise<Response> {
  const zipAsset = findDarwinZipAsset(release);

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
    pub_date: release.published_at || release.created_at || '',
  });
}

async function buildWin32Response(
  env: Env,
  release: Release,
  requestUrl: string
): Promise<Response> {
  // Find the RELEASES file asset
  const releasesAsset = release.assets.find(a => a.name === 'RELEASES');
  if (!releasesAsset) {
    return new Response(null, { status: 204 });
  }

  // Download the RELEASES file content
  const releasesContent = await getAssetContent(env.GITHUB_TOKEN, releasesAsset.id);
  if (!releasesContent) {
    return new Response('Failed to fetch RELEASES', { status: 502 });
  }

  // Rewrite nupkg filenames to point through our /download/ proxy
  // RELEASES format: "SHA1 filename SIZE"
  const baseUrl = new URL(requestUrl).origin;
  const rewritten = releasesContent
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return trimmed;
      // Find the nupkg asset by filename and rewrite to our proxy URL
      const parts = trimmed.split(' ');
      if (parts.length >= 2) {
        const filename = parts[1];
        const nupkgAsset = release.assets.find(a => a.name === filename);
        if (nupkgAsset) {
          parts[1] = `${baseUrl}/download/${nupkgAsset.id}/${encodeURIComponent(filename)}`;
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
// /web/version handler
// ---------------------------------------------------------------------------

/**
 * RL-061 Slice 5 — version probe for the web build's update banner.
 *
 * Strips the leading `v` from the tag (e.g. `v0.2.1` → `0.2.1`) so the
 * renderer can compare directly against `package.json#version` which
 * never carries the prefix. Cache TTL matches the rest of the worker
 * (5 minutes) so a release spike doesn't hammer the GitHub API.
 *
 * 204 (no body) on the "no releases yet" branch — the renderer maps
 * that to `null` and skips the banner render entirely.
 */
async function handleWebVersion(request: Request, env: Env): Promise<Response> {
  const releaseChannel = resolveReleaseChannel(env);
  const canUseCache = releaseChannel === 'stable';
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  if (canUseCache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const release = await getLatestRelease(env.GITHUB_TOKEN, releaseChannel);
  if (!release) {
    const empty = new Response(null, {
      status: 204,
      headers: {
        ...WEB_VERSION_CORS_HEADERS,
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
      },
    });
    if (canUseCache) {
      await cache.put(cacheKey, empty.clone());
    }
    return empty;
  }

  const version = release.tag_name.startsWith('v') ? release.tag_name.slice(1) : release.tag_name;

  const response = new Response(JSON.stringify({ version }), {
    status: 200,
    headers: {
      ...WEB_VERSION_CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
    },
  });
  if (canUseCache) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
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

function methodNotAllowed(): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'GET' },
  });
}
