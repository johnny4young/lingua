import type { Release, ReleaseAsset } from './github';

/**
 * Canonical filename contract for the macOS auto-update ZIP asset.
 *
 * This is retained only for compatibility with older clients that still call
 * the Worker platform feed. Current electron-builder packages read GitHub
 * Releases directly through `electron-updater`; release validation must not
 * depend on this legacy filename contract.
 *
 * Historical `electron-forge` releases emitted
 * `Lingua-darwin-<arch>-<version>.zip`. The
 * legacy `lingua-<version>-darwin-<arch>.zip` ordering is also accepted so a
 * maker/name change cannot silently strand macOS auto-update. Matching is
 * case-insensitive because the product name is `Lingua`.
 */

/**
 * Closed set of architecture tokens the legacy macOS ZIP asset may carry.
 * `universal` remains accepted for compatibility with a possible lipo-merged
 * historical artifact.
 */
export const DARWIN_ZIP_ARCH_PATTERN = '(?:x64|arm64|universal)';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip a single leading `v` so a `v0.6.0` tag and a raw `0.6.0` version both
 * resolve to `0.6.0`. Mirrors `normalizeReleaseVersion` in the JS twin.
 */
export function normalizeVersion(version: string): string {
  return version.replace(/^v/u, '');
}

/** Normalized release version from a GitHub release tag (`v0.6.0` → `0.6.0`). */
export function releaseVersion(release: Pick<Release, 'tag_name'>): string {
  return normalizeVersion(release.tag_name);
}

/**
 * Build the case-insensitive matcher for one specific, ALREADY-NORMALIZED
 * release version (no leading `v`). The version is escaped before interpolation
 * so a value like `1.2.3` cannot widen the pattern through its `.`
 * metacharacters. Kept strip-free so the JS twin's `darwinZipAssetPattern`
 * stays byte-identical for every input.
 */
export function darwinZipAssetPattern(version: string): RegExp {
  const escaped = escapeRegExp(version);
  return new RegExp(
    `^lingua-(?:darwin-${DARWIN_ZIP_ARCH_PATTERN}-${escaped}|${escaped}-darwin-${DARWIN_ZIP_ARCH_PATTERN})\\.zip$`,
    'iu'
  );
}

/**
 * True when `name` is a Lingua macOS update ZIP for exactly `version`. Accepts
 * a raw tag or a normalized version — the leading `v` is stripped here, in
 * lockstep with the release-tooling twin's `isLinguaDarwinZipAsset`.
 */
export function isDarwinZipAssetName(name: string, version: string): boolean {
  return darwinZipAssetPattern(normalizeVersion(version)).test(name);
}

/**
 * Resolve the macOS update ZIP asset on a GitHub release, or `undefined` when
 * none matches the contract. Callers map `undefined` to a 204 "no update".
 */
export function findDarwinZipAsset(release: Release): ReleaseAsset | undefined {
  const pattern = darwinZipAssetPattern(releaseVersion(release));
  return release.assets.find(asset => pattern.test(asset.name));
}
