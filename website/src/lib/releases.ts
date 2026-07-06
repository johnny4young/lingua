/**
 * Build-time release fetcher backed by the public GitHub Releases API for
 * `johnny4young/lingua`. Throws on persistent failure so the build fails loudly
 * rather than shipping a stale or empty downloads page.
 *
 * The lingua repo is public, so the latest release + its assets come straight
 * from `api.github.com/.../releases/latest`, and download links point at
 * `github.com/.../releases/download/...`. (Historically this read an R2 mirror
 * because the repo was private; the R2 bucket now only hosts the oversized web
 * WASM runtime, not release binaries.) Asset sizes come from the API response —
 * no HEAD probes needed. Older releases still come from the committed
 * `changelog.json` (history without download buttons).
 *
 * Asset filenames are parsed for platform/arch so a build-system change can't
 * silently break the download grid; electron-updater metadata
 * (`*.blockmap`, `latest-*.yml`) is filtered out.
 */

import { loadChangelog } from './changelog';

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
  /** Link users can follow for more context. Internal /changelog anchor — the source repo is private. */
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

const DEFAULT_DOWNLOADS_BASE = 'https://downloads.linguacode.dev';
const RETRY_DELAYS_MS = [500, 1000, 2000];

function downloadsBase(): string {
  return (process.env.LINGUA_DOWNLOADS_BASE ?? DEFAULT_DOWNLOADS_BASE).replace(/\/$/, '');
}

function isOfflineMode(): boolean {
  return process.env.LINGUA_SOURCE === 'local';
}

// ────────────────────────────────────────────────────────────────────────────
// Filename inference for platform / arch / format
// ────────────────────────────────────────────────────────────────────────────

function inferPlatformAndArch(name: string): { platform: Platform; arch: Arch; format: Format } {
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
  if (lower === 'releases') return { platform: 'windows', arch: 'unknown', format: 'releases-manifest' };
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
  if (lower.includes('darwin') || lower.includes('mac') || lower.includes('osx') || format === 'dmg') {
    platform = 'macos';
  } else if (format === 'zip' && /\barm64\b|\bx64\b|\bx86_64\b/.test(lower)) {
    // Bare .zip without darwin/mac in name but with mac-style arch — assume mac.
    platform = 'macos';
  } else if (format === 'exe' || format === 'msi' || lower.includes('win32') || lower.includes('windows')) {
    platform = 'windows';
  } else if (format === 'deb' || format === 'rpm' || format === 'appimage' || lower.includes('linux')) {
    platform = 'linux';
  }

  let arch: Arch = 'unknown';
  if (lower.includes('arm64') || lower.includes('aarch64')) arch = 'arm64';
  else if (lower.includes('x86_64') || lower.includes('x64') || lower.includes('amd64')) arch = 'x64';
  else if (lower.includes('universal')) arch = 'universal';

  if ((format === 'exe' || format === 'msi') && arch === 'unknown') arch = 'x64';

  return { platform, arch, format };
}

// ────────────────────────────────────────────────────────────────────────────
// GitHub Releases API
// ────────────────────────────────────────────────────────────────────────────

const GITHUB_REPO = 'johnny4young/lingua';

interface GithubRelease {
  tag_name: string;
  published_at: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/** electron-updater / build metadata that should not surface as a user download. */
function isMetadataAsset(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.blockmap') || lower.endsWith('.yml') || lower.endsWith('.yaml');
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      lastErr = err;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay == null) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`fetch failed after ${RETRY_DELAYS_MS.length + 1} attempts: ${url} — ${(lastErr as Error)?.message ?? lastErr}`);
}

function normalizeVersion(tag: string): string {
  return tag.replace(/^v/, '');
}

function changelogAnchor(version: string): string {
  return `/changelog#v${normalizeVersion(version)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Offline fixture (LINGUA_SOURCE=local)
// ────────────────────────────────────────────────────────────────────────────

async function offlineLatest(): Promise<Release | null> {
  const entries = await loadChangelog();
  const entry = entries[0];
  if (!entry) return null;
  const base = `${downloadsBase()}/v${entry.version}`;
  const macZipName = `lingua-${entry.version}-darwin-arm64.zip`;
  const assets: ReleaseAsset[] = [
    { name: macZipName, downloadUrl: `${base}/${macZipName}`, sizeBytes: null, ...inferPlatformAndArch(macZipName) },
    { name: 'SHA256SUMS.txt', downloadUrl: `${base}/SHA256SUMS.txt`, sizeBytes: null, ...inferPlatformAndArch('SHA256SUMS.txt') },
  ];
  return {
    tag: `v${entry.version}`,
    version: entry.version,
    publishedAt: new Date(`${entry.date}T00:00:00Z`).toISOString(),
    htmlUrl: changelogAnchor(entry.version),
    assets,
    channel: 'stable',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function fetchLatestRelease(): Promise<Release | null> {
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

  let gh: GithubRelease;
  try {
    const res = await fetchWithRetry(apiUrl, { headers });
    gh = (await res.json()) as GithubRelease;
  } catch (err) {
    throw new Error(`Could not load the latest GitHub release from ${apiUrl}: ${(err as Error).message}`);
  }

  if (!gh.tag_name) {
    throw new Error(`GitHub release response from ${apiUrl} has no tag_name`);
  }

  const version = normalizeVersion(gh.tag_name);
  const assets: ReleaseAsset[] = (gh.assets ?? [])
    .filter((a) => !isMetadataAsset(a.name))
    .map((a) => ({
      name: a.name,
      downloadUrl: a.browser_download_url,
      sizeBytes: typeof a.size === 'number' ? a.size : null,
      ...inferPlatformAndArch(a.name),
    }));

  return {
    tag: gh.tag_name,
    version,
    publishedAt: gh.published_at ?? new Date().toISOString(),
    htmlUrl: changelogAnchor(version),
    assets,
    channel: 'stable',
  };
}

/**
 * Older releases, sourced from the committed changelog. No download URLs:
 * the lingua source repo is private and only the latest release is mirrored
 * to R2. Older entries are kept here so the page can still surface release
 * history without dead "Download" links.
 */
export async function fetchOlderReleaseSummaries(
  maxCount: number,
  options: { excludeVersion?: string } = {},
): Promise<OlderReleaseSummary[]> {
  const entries = await loadChangelog();
  const exclude = options.excludeVersion ? normalizeVersion(options.excludeVersion) : null;
  return entries
    .filter((e) => e.version !== exclude)
    .slice(0, maxCount)
    .map((e) => ({
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
  const grouped: Record<Platform, ReleaseAsset[]> = { macos: [], windows: [], linux: [], unknown: [] };
  for (const a of release.assets) grouped[a.platform].push(a);
  return grouped;
}

const SIDECAR_FORMATS: Format[] = ['checksums', 'sbom', 'third-party-licenses', 'releases-manifest', 'nupkg'];

export function isSidecarAsset(asset: ReleaseAsset): boolean {
  return SIDECAR_FORMATS.includes(asset.format);
}

export function findChecksumsAsset(release: Release): ReleaseAsset | null {
  return release.assets.find((a) => a.format === 'checksums') ?? null;
}

export function formatBytes(n: number | null): string {
  if (n == null || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
