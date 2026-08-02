/**
 * Pure contract shared by CLI packaging and publication verification.
 *
 * Keep this module dependency-free: the npm promotion workflow checks out an
 * immutable release tag and validates its tarball without installing the app's
 * development dependency graph.
 */

export const CLI_PACKAGE_NAME = '@linguacode/cli';
export const CLI_REPOSITORY_URL = 'https://github.com/johnny4young/lingua.git';
export const CLI_PACKAGE_CONTENTS = Object.freeze([
  'LICENSE',
  'README.md',
  'bin/lingua.cjs',
  'package.json',
]);

const STABLE_VERSION_PATTERN = /^(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u;
const STABLE_RELEASE_TAG_PATTERN = /^v(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u;

export function stableVersionFromReleaseTag(releaseTag) {
  const match = releaseTag.match(STABLE_RELEASE_TAG_PATTERN);
  if (!match?.groups?.version) {
    throw new Error(`Invalid stable release tag: ${String(releaseTag)}. Expected vX.Y.Z.`);
  }
  return match.groups.version;
}

export function cliNpmArtifactName(version) {
  if (!STABLE_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid stable CLI version: ${String(version)}.`);
  }
  return `linguacode-cli-${version}.tgz`;
}

export function buildCliPackageManifest(rootPackage) {
  return {
    name: CLI_PACKAGE_NAME,
    version: rootPackage.version,
    description: 'Headless offline CLI for Lingua utilities, local runners, and Run Capsules',
    license: 'SEE LICENSE IN LICENSE',
    homepage: 'https://linguacode.dev',
    repository: {
      type: 'git',
      url: CLI_REPOSITORY_URL,
    },
    bugs: {
      url: 'https://github.com/johnny4young/lingua/issues',
    },
    keywords: ['lingua', 'cli', 'code-runner', 'developer-tools', 'offline'],
    bin: {
      lingua: 'bin/lingua.cjs',
    },
    files: ['bin', 'README.md', 'LICENSE'],
    engines: {
      node: '24.x',
    },
    publishConfig: {
      access: 'public',
    },
  };
}

export function assertNpmPackContents(files) {
  const names = files.map(file => file.path).sort();
  if (JSON.stringify(names) !== JSON.stringify(CLI_PACKAGE_CONTENTS)) {
    throw new Error(
      `Unexpected npm package contents. Expected ${CLI_PACKAGE_CONTENTS.join(', ')}; found ${names.join(', ')}`
    );
  }
}

export function assertCliPackageManifest(manifest, expectedVersion) {
  const expected = buildCliPackageManifest({ version: expectedVersion });
  const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, canonicalize(value[key])])
      );
    }
    return value;
  };
  if (JSON.stringify(canonicalize(manifest)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error(
      'CLI package manifest drift: expected the exact dependency-free public manifest without lifecycle scripts or additional fields.'
    );
  }
}
