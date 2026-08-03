const GITHUB_REPO = 'johnny4young/lingua';
const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export interface ReleaseVersionPolicy {
  repositoryVersion: string;
  requireCurrentVersion?: boolean;
}

export interface TrustedReleaseAsset {
  name: string;
  downloadUrl: string;
  sizeBytes: number;
}

export interface TrustedReleaseMetadata {
  tag: string;
  version: string;
  publishedAt: string;
  htmlUrl: string;
  assets: TrustedReleaseAsset[];
}

export interface ReleaseSnapshotFile {
  schemaVersion: 1;
  capturedAt: string;
  release: {
    tag: string;
    publishedAt: string;
    htmlUrl: string;
    draft: false;
    prerelease: false;
    assets: TrustedReleaseAsset[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Release metadata ${key} must be a non-empty string`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Release metadata ${key} must be a boolean`);
  }
  return value;
}

function assertIsoTimestamp(value: string, label: string): void {
  const parsed = Date.parse(value);
  if (
    !Number.isFinite(parsed) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  ) {
    throw new Error(`${label} must be a UTC ISO-8601 timestamp`);
  }
}

function versionFromTag(tag: string): string {
  const match = tag.match(STABLE_TAG_PATTERN);
  if (!match) {
    throw new Error(`Release tag must be a stable vX.Y.Z tag: ${tag}`);
  }
  return tag.slice(1);
}

function stableVersionParts(version: string, label: string): readonly bigint[] {
  const match = version.match(STABLE_VERSION_PATTERN);
  if (!match) {
    throw new Error(`${label} must be a stable X.Y.Z version: ${version}`);
  }
  return match.slice(1).map(part => BigInt(part));
}

export function compareStableVersions(left: string, right: string): number {
  const leftParts = stableVersionParts(left, 'Left version');
  const rightParts = stableVersionParts(right, 'Right version');
  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index]!;
    const rightPart = rightParts[index]!;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

function assertReleaseVersion(
  releaseVersion: string,
  policy: ReleaseVersionPolicy,
  label: string
): void {
  const comparison = compareStableVersions(releaseVersion, policy.repositoryVersion);
  if (policy.requireCurrentVersion && comparison !== 0) {
    throw new Error(
      `${label} version ${releaseVersion} does not match repository version ${policy.repositoryVersion}`
    );
  }
  if (comparison > 0) {
    throw new Error(
      `${label} version ${releaseVersion} is newer than repository version ${policy.repositoryVersion}`
    );
  }
}

function expectedReleaseUrl(tag: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`;
}

function expectedAssetUrl(tag: string, name: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${encodeURIComponent(name)}`;
}

function parseAsset(value: unknown, tag: string, index: number): TrustedReleaseAsset {
  if (!isRecord(value)) {
    throw new Error(`Release asset ${index} must be an object`);
  }
  const name = requiredString(value, 'name');
  if (name === '.' || name === '..' || /[/\\\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error(`Release asset ${index} has an unsafe basename: ${name}`);
  }
  const downloadUrl = requiredString(value, 'downloadUrl');
  const expectedUrl = expectedAssetUrl(tag, name);
  if (downloadUrl !== expectedUrl) {
    throw new Error(`Release asset ${name} must use the canonical GitHub download URL`);
  }
  const sizeBytes = value.sizeBytes;
  if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) < 0) {
    throw new Error(`Release asset ${name} sizeBytes must be a non-negative safe integer`);
  }
  return { name, downloadUrl, sizeBytes: sizeBytes as number };
}

function requiredDesktopAssets(version: string): string[] {
  return [
    `Lingua-${version}-mac-arm64.dmg`,
    `Lingua-${version}-mac-x64.dmg`,
    `Lingua-${version}-win-x64.exe`,
    `Lingua-${version}-linux-x86_64.AppImage`,
  ];
}

function assertUsableAssetSet(assets: TrustedReleaseAsset[], version: string): void {
  if (assets.length === 0) {
    throw new Error('Release metadata must contain at least one asset');
  }
  const names = new Set<string>();
  for (const asset of assets) {
    if (names.has(asset.name)) {
      throw new Error(`Release metadata contains a duplicate asset: ${asset.name}`);
    }
    names.add(asset.name);
  }
  for (const requiredName of requiredDesktopAssets(version)) {
    if (!names.has(requiredName)) {
      throw new Error(`Release metadata is missing supported desktop asset: ${requiredName}`);
    }
  }
  if (!names.has('SHA256SUMS.txt')) {
    throw new Error('Release metadata must contain SHA256SUMS.txt');
  }
}

function parseTrustedRelease(
  value: unknown,
  options: { versionPolicy?: ReleaseVersionPolicy; versionLabel?: string } = {}
): TrustedReleaseMetadata {
  if (!isRecord(value)) throw new Error('Release metadata must be an object');

  const tag = requiredString(value, 'tag');
  const version = versionFromTag(tag);
  if (options.versionPolicy) {
    assertReleaseVersion(version, options.versionPolicy, options.versionLabel ?? 'Release');
  }
  const publishedAt = requiredString(value, 'publishedAt');
  assertIsoTimestamp(publishedAt, 'Release publishedAt');
  const htmlUrl = requiredString(value, 'htmlUrl');
  if (htmlUrl !== expectedReleaseUrl(tag)) {
    throw new Error(`Release ${tag} must use the canonical GitHub release URL`);
  }
  if (requiredBoolean(value, 'draft')) {
    throw new Error(`Release ${tag} is a draft`);
  }
  if (requiredBoolean(value, 'prerelease')) {
    throw new Error(`Release ${tag} is a prerelease`);
  }
  if (!Array.isArray(value.assets)) {
    throw new Error('Release metadata assets must be an array');
  }
  const assets = value.assets.map((asset, index) => parseAsset(asset, tag, index));
  assertUsableAssetSet(assets, version);
  return { tag, version, publishedAt, htmlUrl, assets };
}

export function parseGithubRelease(
  value: unknown,
  versionPolicy?: ReleaseVersionPolicy
): TrustedReleaseMetadata {
  if (!isRecord(value)) throw new Error('GitHub release response must be an object');
  const rawAssets = value.assets;
  if (!Array.isArray(rawAssets)) {
    throw new Error('GitHub release response assets must be an array');
  }
  return parseTrustedRelease(
    {
      tag: value.tag_name,
      publishedAt: value.published_at,
      htmlUrl: value.html_url,
      draft: value.draft,
      prerelease: value.prerelease,
      assets: rawAssets.map(asset => {
        if (!isRecord(asset)) return asset;
        return {
          name: asset.name,
          downloadUrl: asset.browser_download_url,
          sizeBytes: asset.size,
        };
      }),
    },
    { versionPolicy, versionLabel: 'Public release' }
  );
}

export function createReleaseSnapshot(
  value: unknown,
  capturedAt = new Date().toISOString()
): ReleaseSnapshotFile {
  assertIsoTimestamp(capturedAt, 'Release snapshot capturedAt');
  const release = parseGithubRelease(value);
  return {
    schemaVersion: 1,
    capturedAt,
    release: {
      tag: release.tag,
      publishedAt: release.publishedAt,
      htmlUrl: release.htmlUrl,
      draft: false,
      prerelease: false,
      assets: release.assets,
    },
  };
}

export function parseReleaseSnapshot(
  value: unknown,
  repositoryVersion: string,
  options: { requireCurrentVersion?: boolean } = {}
): TrustedReleaseMetadata {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Release snapshot schemaVersion must be 1');
  }
  const capturedAt = requiredString(value, 'capturedAt');
  assertIsoTimestamp(capturedAt, 'Release snapshot capturedAt');
  const release = parseTrustedRelease(value.release, {
    versionPolicy: {
      repositoryVersion,
      requireCurrentVersion: options.requireCurrentVersion,
    },
    versionLabel: 'Release snapshot',
  });
  if (Date.parse(capturedAt) < Date.parse(release.publishedAt)) {
    throw new Error('Release snapshot cannot predate the published release');
  }
  return release;
}
