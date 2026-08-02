/**
 * Build-time release fetcher backed by the public GitHub Releases API for
 * `johnny4young/lingua`. Recoverable transport failures use a committed,
 * source-bounded snapshot; invalid or untrusted metadata still fails loudly.
 *
 * The lingua repo is public, so the latest release + its assets come straight
 * from `api.github.com/.../releases/latest`, and download links point at
 * `github.com/.../releases/download/...`. Historically this read a separate
 * mirror; the R2 bucket now only hosts oversized web runtimes, not release
 * binaries. Asset sizes come from the API response —
 * no HEAD probes needed. Older releases still come from the committed
 * `changelog.json` (history without download buttons).
 *
 * Asset filenames are parsed for platform/arch so a build-system change can't
 * silently break the download grid; electron-updater metadata
 * (`*.blockmap`, `latest-*.yml`) is filtered out.
 */

import { loadCandidateChangelog, loadPublishedChangelog } from './changelog.ts';
import packageJson from '../../../package.json' with { type: 'json' };
import releaseSnapshot from '../data/latest-release.json' with { type: 'json' };
import {
  parseGithubRelease,
  parseReleaseSnapshot,
  type TrustedReleaseMetadata,
} from './releaseSnapshot.ts';

export type Platform = 'macos' | 'windows' | 'linux' | 'unknown';
export type Arch = 'arm64' | 'x64' | 'universal' | 'unknown';
export type Format =
  | 'zip'
  | 'dmg'
  | 'exe'
  | 'msi'
  | 'nupkg'
  | 'deb'
  | 'rpm'
  | 'appimage'
  | 'checksums'
  | 'sbom'
  | 'third-party-licenses'
  | 'releases-manifest'
  | 'other';

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  /** `null` when size could not be resolved (offline fixture, or HEAD failed). */
  sizeBytes: number | null;
  platform: Platform;
  arch: Arch;
  format: Format;
}

export interface Release {
  tag: string;
  version: string;
  publishedAt: string;
  /** Local changelog anchor used for release context. */
  htmlUrl: string;
  assets: ReleaseAsset[];
  channel: string;
}

export interface OlderReleaseSummary {
  version: string;
  date: string;
  notesExcerpt: string[];
  changelogAnchor: string;
}

const RETRY_DELAYS_MS = [500, 1000, 2000];
const REQUEST_TIMEOUT_MS = 5000;

function isOfflineMode(): boolean {
  return process.env.LINGUA_SOURCE === 'local';
}

// ────────────────────────────────────────────────────────────────────────────
// Filename inference for platform / arch / format
// ────────────────────────────────────────────────────────────────────────────

export function inferPlatformAndArch(name: string): {
  platform: Platform;
  arch: Arch;
  format: Format;
} {
  const lower = name.toLowerCase();

  if (lower === 'sha256sums.txt' || lower.endsWith('.sha256') || lower.endsWith('.sha256sums')) {
    return { platform: 'unknown', arch: 'unknown', format: 'checksums' };
  }
  if (lower.endsWith('.cyclonedx.json') || lower.includes('sbom')) {
    return { platform: 'unknown', arch: 'unknown', format: 'sbom' };
  }
  if (lower.includes('third_party_license') || lower.includes('third-party-license')) {
    return { platform: 'unknown', arch: 'unknown', format: 'third-party-licenses' };
  }
  if (lower === 'releases')
    return { platform: 'windows', arch: 'unknown', format: 'releases-manifest' };
  if (lower.endsWith('.nupkg')) return { platform: 'windows', arch: 'x64', format: 'nupkg' };

  let format: Format = 'other';
  if (lower.endsWith('.zip')) format = 'zip';
  else if (lower.endsWith('.dmg')) format = 'dmg';
  else if (lower.endsWith('.exe')) format = 'exe';
  else if (lower.endsWith('.msi')) format = 'msi';
  else if (lower.endsWith('.deb')) format = 'deb';
  else if (lower.endsWith('.rpm')) format = 'rpm';
  else if (lower.endsWith('.appimage')) format = 'appimage';

  let platform: Platform = 'unknown';
  if (
    lower.includes('darwin') ||
    lower.includes('mac') ||
    lower.includes('osx') ||
    format === 'dmg'
  ) {
    platform = 'macos';
  } else if (format === 'zip' && /\barm64\b|\bx64\b|\bx86_64\b/.test(lower)) {
    // Bare .zip without darwin/mac in name but with mac-style arch — assume mac.
    platform = 'macos';
  } else if (
    format === 'exe' ||
    format === 'msi' ||
    lower.includes('win32') ||
    lower.includes('windows')
  ) {
    platform = 'windows';
  } else if (
    format === 'deb' ||
    format === 'rpm' ||
    format === 'appimage' ||
    lower.includes('linux')
  ) {
    platform = 'linux';
  }

  let arch: Arch = 'unknown';
  if (lower.includes('arm64') || lower.includes('aarch64')) arch = 'arm64';
  else if (lower.includes('x86_64') || lower.includes('x64') || lower.includes('amd64'))
    arch = 'x64';
  else if (lower.includes('universal')) arch = 'universal';

  if ((format === 'exe' || format === 'msi') && arch === 'unknown') arch = 'x64';

  return { platform, arch, format };
}

// ────────────────────────────────────────────────────────────────────────────
// GitHub Releases API
// ────────────────────────────────────────────────────────────────────────────

const GITHUB_REPO = 'johnny4young/lingua';

export interface ReleaseFetchOptions {
  fetchImpl?: typeof fetch;
  retryDelaysMs?: readonly number[];
  warn?: (message: string) => void;
}

/** electron-updater / build metadata that should not surface as a user download. */
function isMetadataAsset(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.blockmap') || lower.endsWith('.yml') || lower.endsWith('.yaml');
}

class ReleaseTransportError extends Error {}
class ReleaseResponseError extends Error {}

function isRetryableResponse(response: Response): boolean {
  return (
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: Required<Pick<ReleaseFetchOptions, 'fetchImpl' | 'retryDelaysMs'>>
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= options.retryDelaysMs.length; attempt += 1) {
    try {
      const res = await options.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return res;
      if (!isRetryableResponse(res)) {
        throw new ReleaseResponseError(
          `GitHub release request failed with HTTP ${res.status} ${res.statusText}`
        );
      }
      lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      if (err instanceof ReleaseResponseError) throw err;
      lastErr = err;
    }
    const delay = options.retryDelaysMs[attempt];
    if (delay == null) break;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new ReleaseTransportError(
    `fetch failed after ${options.retryDelaysMs.length + 1} attempts: ${url} — ${(lastErr as Error)?.message ?? lastErr}`
  );
}

function toRelease(metadata: TrustedReleaseMetadata): Release {
  const assets: ReleaseAsset[] = metadata.assets
    .filter(asset => !isMetadataAsset(asset.name))
    .map(asset => ({
      name: asset.name,
      downloadUrl: asset.downloadUrl,
      sizeBytes: asset.sizeBytes,
      ...inferPlatformAndArch(asset.name),
    }));
  return {
    tag: metadata.tag,
    version: metadata.version,
    publishedAt: metadata.publishedAt,
    htmlUrl: changelogAnchor(metadata.version),
    assets,
    channel: 'stable',
  };
}

async function snapshotLatest(): Promise<Release> {
  const entries = await loadCandidateChangelog();
  const changelogVersion = entries[0]?.version;
  if (!changelogVersion) {
    throw new Error('Cannot validate the release snapshot because the changelog is empty');
  }
  if (changelogVersion !== packageJson.version) {
    throw new Error(
      `Repository version ${packageJson.version} does not match changelog version ${changelogVersion}`
    );
  }
  return toRelease(parseReleaseSnapshot(releaseSnapshot, packageJson.version));
}

function normalizeVersion(tag: string): string {
  return tag.replace(/^v/, '');
}

function changelogAnchor(version: string): string {
  return `/changelog#v${normalizeVersion(version)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Validated repository snapshot (LINGUA_SOURCE=local or recoverable API failure)
// ────────────────────────────────────────────────────────────────────────────

async function offlineLatest(): Promise<Release> {
  return snapshotLatest();
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function fetchLatestRelease(
  options: ReleaseFetchOptions = {}
): Promise<Release | null> {
  if (isOfflineMode()) return offlineLatest();

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // A token (CI passes GITHUB_TOKEN) lifts the 60-req/hour unauthenticated
  // limit; unauthenticated still works fine for an occasional build.
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const fetchOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    retryDelaysMs: options.retryDelaysMs ?? RETRY_DELAYS_MS,
  };
  let response: Response;
  try {
    response = await fetchWithRetry(apiUrl, { headers }, fetchOptions);
  } catch (err) {
    if (err instanceof ReleaseTransportError) {
      const snapshot = await snapshotLatest();
      const warning =
        `GitHub release metadata is temporarily unavailable; using the validated ` +
        `repository snapshot for ${snapshot.tag}. ${(err as Error).message}`;
      (options.warn ?? console.warn)(warning);
      return snapshot;
    }
    throw new Error(
      `Could not load the latest GitHub release from ${apiUrl}: ${(err as Error).message}`
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    throw new Error(
      `GitHub release response from ${apiUrl} is not valid JSON: ${(err as Error).message}`
    );
  }
  return toRelease(
    parseGithubRelease(payload, {
      repositoryVersion: packageJson.version,
    })
  );
}

/**
 * Older releases are sourced from the committed changelog. The latest release
 * owns the download matrix; historical entries link to their changelog anchors.
 */
export async function fetchOlderReleaseSummaries(
  maxCount: number,
  options: { excludeVersion?: string } = {}
): Promise<OlderReleaseSummary[]> {
  const entries = await loadPublishedChangelog();
  const exclude = options.excludeVersion ? normalizeVersion(options.excludeVersion) : null;
  return entries
    .filter(e => e.version !== exclude)
    .slice(0, maxCount)
    .map(e => ({
      version: e.version,
      date: e.date,
      notesExcerpt: excerptItems(e, 4),
      changelogAnchor: changelogAnchor(e.version),
    }));
}

function excerptItems(entry: { sections: { items: string[] }[] }, max: number): string[] {
  const out: string[] = [];
  for (const section of entry.sections) {
    for (const item of section.items) {
      out.push(item);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Component helpers
// ────────────────────────────────────────────────────────────────────────────

export function groupAssetsByPlatform(release: Release): Record<Platform, ReleaseAsset[]> {
  const grouped: Record<Platform, ReleaseAsset[]> = {
    macos: [],
    windows: [],
    linux: [],
    unknown: [],
  };
  for (const a of release.assets) grouped[a.platform].push(a);
  return grouped;
}

const SIDECAR_FORMATS: Format[] = [
  'checksums',
  'sbom',
  'third-party-licenses',
  'releases-manifest',
  'nupkg',
];

export function isSidecarAsset(asset: ReleaseAsset): boolean {
  return SIDECAR_FORMATS.includes(asset.format);
}

/**
 * Keep the human download grid focused on installers. macOS zip files remain
 * attached for electron-updater, but a person should choose the dmg for their
 * architecture; showing both made the Intel build easier to select by mistake.
 */
export function downloadableAssets(assets: ReleaseAsset[]): ReleaseAsset[] {
  const installerAssets = assets.filter(asset => !isSidecarAsset(asset));
  const dmgArches = new Set(
    installerAssets.filter(asset => asset.format === 'dmg').map(asset => asset.arch)
  );
  const archRank: Record<Arch, number> = {
    arm64: 0,
    x64: 1,
    universal: 2,
    unknown: 3,
  };
  return installerAssets
    .filter(
      asset => !(asset.platform === 'macos' && asset.format === 'zip' && dmgArches.has(asset.arch))
    )
    .sort(
      (left, right) =>
        archRank[left.arch] - archRank[right.arch] || left.name.localeCompare(right.name)
    );
}

export function findChecksumsAsset(release: Release): ReleaseAsset | null {
  return release.assets.find(a => a.format === 'checksums') ?? null;
}

export function formatBytes(n: number | null): string {
  if (n == null || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
