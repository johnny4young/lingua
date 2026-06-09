/**
 * Canonical filename contract for the macOS auto-update ZIP asset — the
 * release-tooling twin of `update-server/src/darwinAsset.ts`.
 *
 * The update server owns the runtime contract (the worker decides whether the
 * feed can serve an asset). This module re-encodes the SAME contract for Node
 * release scripts so the release workflow can fail closed BEFORE publish when a
 * maker/name change produces an asset the feed cannot match. The two
 * implementations are pinned byte-equivalent (same regex source + flags) by
 * `tests/scripts/darwinAsset.test.ts`; that test is the mechanical lock against
 * the silent-no-update regression that stranded macOS auto-update across
 * v0.4.0/v0.5.0.
 *
 * Keep this file dependency-free (no imports) so any release script can import
 * it without dragging in worker/runtime modules.
 */

/**
 * Closed set of architecture tokens the macOS ZIP asset may carry: the two
 * per-arch Forge builds (`x64`, `arm64`) plus a reserved `universal` token for
 * a future lipo-merged single artifact. Must equal the worker twin verbatim.
 */
export const DARWIN_ZIP_ARCH_PATTERN = '(?:x64|arm64|universal)';

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip a single leading `v` so a `v0.6.0` tag and a raw `0.6.0` version both
 * resolve to `0.6.0`. Mirrors `releaseVersion` in the worker twin. Non-string
 * input collapses to an empty version (which matches nothing).
 *
 * @param {unknown} version
 * @returns {string}
 */
export function normalizeReleaseVersion(version) {
  return typeof version === 'string' ? version.replace(/^v/u, '') : '';
}

/**
 * Build the case-insensitive matcher for one specific, ALREADY-NORMALIZED
 * release version (no leading `v`). The version is escaped before interpolation
 * so its `.` separators cannot widen the pattern. Both twins keep this builder
 * strip-free so their regex source stays byte-identical for every input;
 * v-tag normalization lives in `isLinguaDarwinZipAsset` /
 * `normalizeReleaseVersion`.
 *
 * @param {string} version normalized version, e.g. `0.6.0`
 * @returns {RegExp}
 */
export function darwinZipAssetPattern(version) {
  const escaped = escapeRegExp(version);
  return new RegExp(
    `^lingua-(?:darwin-${DARWIN_ZIP_ARCH_PATTERN}-${escaped}|${escaped}-darwin-${DARWIN_ZIP_ARCH_PATTERN})\\.zip$`,
    'iu'
  );
}

/**
 * True when `name` is a Lingua macOS update ZIP for exactly `version`. Accepts
 * a raw tag or a normalized version — the leading `v` is stripped here, in
 * lockstep with the worker twin's `isDarwinZipAssetName`.
 *
 * @param {string} name asset filename (basename, no path)
 * @param {string} version release version, with or without a leading `v`
 * @returns {boolean}
 */
export function isLinguaDarwinZipAsset(name, version) {
  if (typeof name !== 'string') return false;
  return darwinZipAssetPattern(normalizeReleaseVersion(version)).test(name);
}
