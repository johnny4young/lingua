/**
 * Build-time release fetcher backed by the public R2 mirror at
 * `downloads.linguacode.dev`. Throws on persistent failure so the build fails
 * loudly rather than shipping a stale or empty downloads page.
 *
 * The marketing site is the only consumer; the lingua source repo is private,
 * so direct `github.com/.../releases/download/...` links cannot work. R2 is the
 * public download surface, with the root `manifest.json` as the single source
 * of truth for the latest release. Older releases come from the committed
 * `changelog.json` (no download buttons — there are no public binaries for
 * pre-mirror versions).
 *
 * Asset filenames are parsed for platform/arch — same logic as the old
 * GitHub-Releases path so future build-system changes don't silently break the
 * download grid. Sizes are pulled via HEAD requests against R2 at build time.
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
// Filename inference (kept from the previous GitHub-Releases path)
// ────────────────────────────────────────────────────────────────────────────

function basename(url: string): string {
  const path = url.split('?')[0].split('#')[0];
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? url;
}

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
// R2 manifest parsing
// ────────────────────────────────────────────────────────────────────────────

interface R2Manifest {
  latest: string;
  channel?: string;
  publishedAt?: string;
  publicBase?: string;
  assets: unknown;
}

function collectAssetUrls(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    if (/^https?:\/\//.test(node)) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectAssetUrls(item, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectAssetUrls(value, out);
  }
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

async function headSize(url: string): Promise<number | null> {
  try {
    // Node `fetch` advertises gzip by default; R2 then omits `content-length`
    // on HEAD for compressible content (text, JSON). Force identity so the
    // header is always the real byte count.
    const res = await fetchWithRetry(url, {
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'identity' },
    });
    const len = res.headers.get('content-length');
    return len ? Number.parseInt(len, 10) : null;
  } catch {
    return null;
  }
}

async function buildAssetsFromUrls(urls: string[]): Promise<ReleaseAsset[]> {
  const seen = new Set<string>();
  const unique = urls.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  const sizes = await Promise.all(unique.map((u) => headSize(u)));
  return unique.map((url, i) => {
    const name = basename(url);
    return { name, downloadUrl: url, sizeBytes: sizes[i], ...inferPlatformAndArch(name) };
  });
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

  const manifestUrl = `${downloadsBase()}/manifest.json`;
  let manifest: R2Manifest;
  try {
    const res = await fetchWithRetry(manifestUrl, {
      headers: { Accept: 'application/json' },
    });
    manifest = (await res.json()) as R2Manifest;
  } catch (err) {
    throw new Error(`Could not load R2 release manifest from ${manifestUrl}: ${(err as Error).message}`);
  }

  if (!manifest.latest) {
    throw new Error(`R2 manifest at ${manifestUrl} has no "latest" field`);
  }

  const urls: string[] = [];
  collectAssetUrls(manifest.assets, urls);
  if (urls.length === 0) {
    throw new Error(`R2 manifest at ${manifestUrl} has no asset URLs`);
  }

  const assets = await buildAssetsFromUrls(urls);
  const version = normalizeVersion(manifest.latest);

  return {
    tag: manifest.latest.startsWith('v') ? manifest.latest : `v${version}`,
    version,
    publishedAt: manifest.publishedAt ?? new Date().toISOString(),
    htmlUrl: changelogAnchor(version),
    assets,
    channel: manifest.channel ?? 'stable',
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
