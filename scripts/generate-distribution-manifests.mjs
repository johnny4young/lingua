#!/usr/bin/env node

/**
 * Generate the Homebrew cask and winget manifests for a published release.
 *
 * Both package managers describe a release by (version, download URL,
 * SHA256). All three already exist on the GitHub Release, so this script
 * derives the manifests from `SHA256SUMS.txt` rather than re-hashing or
 * hand-copying digests — a hand-edited digest is the classic way these
 * manifests rot.
 *
 * Distribution reality this encodes (see docs/runbooks/distribution-channels.md):
 *   - Homebrew's central `homebrew-cask` rejects self-submitted apps below
 *     90 forks / 90 watchers / 225 stars, so the cask targets OUR OWN tap
 *     (`brew install --cask <owner>/tap/lingua`), which has no such gate.
 *   - winget accepts any publisher, but its validation runs SmartScreen
 *     against the installer; an unsigned .exe is expected to fail. The
 *     manifests are therefore generated and validated locally, ready to
 *     submit the moment Authenticode signing is configured.
 *
 * Pure render functions are exported for unit tests; the CLI only does I/O.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_OUTPUT_ROOT = path.join(repoRoot, 'packaging');
export const GITHUB_REPO = 'johnny4young/lingua';
export const WINGET_PACKAGE_IDENTIFIER = 'Johnny4young.Lingua';
/** winget manifest schema the generated files target. */
export const WINGET_MANIFEST_VERSION = '1.6.0';

/**
 * Parse a `SHA256SUMS.txt` produced by `prepare-release-payload.mjs`:
 * `<64-hex>  <basename>` per line. Returns a name -> digest map.
 * Tolerates blank lines and the `*name` binary marker some tools emit.
 */
export function parseChecksums(text) {
  const digests = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line);
    if (!match) {
      throw new Error(`Unparsable checksum line: ${rawLine}`);
    }
    const name = match[2].trim();
    if (digests.has(name)) {
      throw new Error(`Duplicate checksum entry: ${name}`);
    }
    digests.set(name, match[1].toLowerCase());
  }
  if (digests.size === 0) {
    throw new Error('Checksum manifest is empty');
  }
  return digests;
}

function requireDigest(digests, name) {
  const digest = digests.get(name);
  if (!digest) {
    throw new Error(
      `Release is missing ${name}; cannot generate a distribution manifest without its SHA256`
    );
  }
  return digest;
}

/** Asset basenames for a version, mirroring electron-builder's artifactName. */
export function releaseAssetNames(version) {
  return {
    macArm: `Lingua-${version}-mac-arm64.dmg`,
    macIntel: `Lingua-${version}-mac-x64.dmg`,
    windows: `Lingua-${version}-win-x64.exe`,
  };
}

/**
 * Render the Homebrew cask.
 *
 * `arch`/`version` interpolation keeps a single URL template for both
 * architectures, which is what `brew bump-cask-pr` expects to rewrite on
 * the next release.
 */
export function renderHomebrewCask({ version, digests, repo = GITHUB_REPO }) {
  const names = releaseAssetNames(version);
  const armSha = requireDigest(digests, names.macArm);
  const intelSha = requireDigest(digests, names.macIntel);

  return `cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${armSha}",
         intel: "${intelSha}"

  url "https://github.com/${repo}/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg",
      verified: "github.com/${repo}/"
  name "Lingua"
  desc "Multi-language code runner for your desktop"
  homepage "https://linguacode.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :monterey

  app "Lingua.app"

  zap trash: [
    "~/Library/Application Support/Lingua",
    "~/Library/Caches/com.lingua.app",
    "~/Library/Logs/Lingua",
    "~/Library/Preferences/com.lingua.app.plist",
    "~/Library/Saved Application State/com.lingua.app.savedState",
  ]
end
`;
}

/**
 * Render the three winget manifest documents (version / installer / locale).
 * Returns `{ [filename]: contents }`.
 */
export function renderWingetManifests({
  version,
  digests,
  repo = GITHUB_REPO,
  releaseDate,
}) {
  const names = releaseAssetNames(version);
  const installerSha = requireDigest(digests, names.windows).toUpperCase();
  const url = `https://github.com/${repo}/releases/download/v${version}/${names.windows}`;
  const id = WINGET_PACKAGE_IDENTIFIER;
  const schema = (kind) =>
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${kind}.${WINGET_MANIFEST_VERSION}.schema.json`;

  const versionManifest = `${schema('version')}

PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;

  // NSIS one-click per-user install (electron-builder nsis: oneClick +
  // perMachine false), so the scope is user and silent switches are NSIS's.
  const installerManifest = `${schema('installer')}

PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerType: nullsoft
Scope: user
InstallModes:
  - interactive
  - silent
  - silentWithProgress
UpgradeBehavior: install
${releaseDate ? `ReleaseDate: ${releaseDate}\n` : ''}Installers:
  - Architecture: x64
    InstallerUrl: ${url}
    InstallerSha256: ${installerSha}
ManifestType: installer
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;

  const localeManifest = `${schema('defaultLocale')}

PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: johnny4young
PublisherUrl: https://linguacode.dev/
PublisherSupportUrl: https://github.com/${repo}/issues
PackageName: Lingua
PackageUrl: https://linguacode.dev/
License: Proprietary
LicenseUrl: https://github.com/${repo}/blob/main/LICENSE
Copyright: Copyright (c) Lingua contributors
ShortDescription: Multi-language code runner for your desktop
Description: |-
  Lingua runs JavaScript, TypeScript, Python, Go, and Rust in one Monaco
  window. It is desktop-first and local-first: Python ships offline via
  Pyodide, telemetry is off by default, and the optional AI assistance uses
  your own endpoint and shows the exact payload before sending anything.
  Also includes SQL and HTTP workspaces plus 31 developer utilities.
Moniker: lingua
Tags:
  - code-runner
  - developer-tools
  - javascript
  - playground
  - python
  - scratchpad
  - typescript
ReleaseNotesUrl: https://github.com/${repo}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: ${WINGET_MANIFEST_VERSION}
`;

  return {
    [`${id}.yaml`]: versionManifest,
    [`${id}.installer.yaml`]: installerManifest,
    [`${id}.locale.en-US.yaml`]: localeManifest,
  };
}

/** Fetch `SHA256SUMS.txt` for a tag straight off the GitHub Release. */
async function fetchChecksumsFromRelease(tag, repo, fetchImpl = fetch) {
  const url = `https://github.com/${repo}/releases/download/${tag}/SHA256SUMS.txt`;
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(
      `Could not download SHA256SUMS.txt for ${tag} (HTTP ${response.status}). Is the release published?`
    );
  }
  return response.text();
}

export async function generateDistributionManifests({
  tag,
  checksumsPath,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  repo = GITHUB_REPO,
  releaseDate,
  fetchImpl,
}) {
  const version = tag.replace(/^v/, '');
  const checksumText = checksumsPath
    ? await readFile(checksumsPath, 'utf8')
    : await fetchChecksumsFromRelease(tag, repo, fetchImpl);
  const digests = parseChecksums(checksumText);

  const cask = renderHomebrewCask({ version, digests, repo });
  const winget = renderWingetManifests({ version, digests, repo, releaseDate });

  const caskDir = path.join(outputRoot, 'homebrew', 'Casks');
  const wingetDir = path.join(outputRoot, 'winget');
  await mkdir(caskDir, { recursive: true });
  await mkdir(wingetDir, { recursive: true });

  const written = [];
  const caskPath = path.join(caskDir, 'lingua.rb');
  await writeFile(caskPath, cask, 'utf8');
  written.push(caskPath);
  for (const [name, contents] of Object.entries(winget)) {
    const target = path.join(wingetDir, name);
    await writeFile(target, contents, 'utf8');
    written.push(target);
  }
  return { version, written };
}

function parseArgs(argv) {
  const args = { tag: undefined, checksumsPath: undefined, releaseDate: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tag') args.tag = argv[++index];
    else if (arg === '--checksums') args.checksumsPath = argv[++index];
    else if (arg === '--release-date') args.releaseDate = argv[++index];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tag) {
    console.error(
      'Usage: node scripts/generate-distribution-manifests.mjs --tag vX.Y.Z [--checksums path] [--release-date YYYY-MM-DD]'
    );
    process.exitCode = 1;
    return;
  }
  const { version, written } = await generateDistributionManifests(args);
  console.log(`Generated distribution manifests for ${version}:`);
  for (const file of written) {
    console.log(`  ${path.relative(repoRoot, file)}`);
  }
}

// `pathToFileURL` rather than a hand-built `file://` string: on Windows the
// latter never matches `import.meta.url`, so the CLI would silently no-op.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
