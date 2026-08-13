import { describe, expect, it } from 'vitest';
import {
  parseChecksums,
  releaseAssetNames,
  renderHomebrewCliFormula,
  renderHomebrewCask,
  renderWingetManifests,
  WINGET_MANIFEST_VERSION,
  WINGET_PACKAGE_IDENTIFIER,
} from '../../scripts/generate-distribution-manifests.mjs';

const ARM_SHA = 'a'.repeat(64);
const INTEL_SHA = 'b'.repeat(64);
const WIN_SHA = 'c'.repeat(64);
const CLI_SHA = 'd'.repeat(64);

function digestsFor(version: string): Map<string, string> {
  const names = releaseAssetNames(version);
  return new Map([
    [names.macArm, ARM_SHA],
    [names.macIntel, INTEL_SHA],
    [names.windows, WIN_SHA],
    [names.cliNpm, CLI_SHA],
  ]);
}

describe('parseChecksums', () => {
  it('parses the SHA256SUMS.txt shape the release payload writes', () => {
    const digests = parseChecksums(
      `${ARM_SHA}  Lingua-0.14.0-mac-arm64.dmg\n${WIN_SHA}  Lingua-0.14.0-win-x64.exe\n`
    );
    expect(digests.get('Lingua-0.14.0-mac-arm64.dmg')).toBe(ARM_SHA);
    expect(digests.get('Lingua-0.14.0-win-x64.exe')).toBe(WIN_SHA);
  });

  it('tolerates blank lines and the binary asterisk marker', () => {
    const digests = parseChecksums(`\n${ARM_SHA} *Lingua-0.14.0-mac-arm64.dmg\n\n`);
    expect(digests.get('Lingua-0.14.0-mac-arm64.dmg')).toBe(ARM_SHA);
  });

  it('normalises digest case', () => {
    const digests = parseChecksums(`${ARM_SHA.toUpperCase()}  asset.dmg\n`);
    expect(digests.get('asset.dmg')).toBe(ARM_SHA);
  });

  it('rejects an unparsable line rather than silently skipping it', () => {
    expect(() => parseChecksums('not-a-checksum line\n')).toThrow(/Unparsable/);
  });

  it('rejects duplicate entries', () => {
    expect(() => parseChecksums(`${ARM_SHA}  dup.dmg\n${INTEL_SHA}  dup.dmg\n`)).toThrow(
      /Duplicate/
    );
  });

  it('rejects an empty manifest', () => {
    expect(() => parseChecksums('\n\n')).toThrow(/empty/);
  });
});

describe('renderHomebrewCask', () => {
  const cask = renderHomebrewCask({ version: '0.14.0', digests: digestsFor('0.14.0') });

  it('pins both architectures to their real digests', () => {
    expect(cask).toContain(`sha256 arm:   "${ARM_SHA}"`);
    expect(cask).toContain(`intel: "${INTEL_SHA}"`);
  });

  it('uses one interpolated URL template so bump-cask-pr can rewrite it', () => {
    expect(cask).toContain(
      'url "https://github.com/johnny4young/lingua/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg"'
    );
    expect(cask).toContain('arch arm: "arm64", intel: "x64"');
  });

  it('declares the app artifact, version, and auto-update behaviour', () => {
    expect(cask).toContain('version "0.14.0"');
    // The DMG ships `lingua.app` (electron-builder executableName), and
    // `brew audit --cask --online` fails the cask when the artifact case
    // does not match: it breaks on case-sensitive filesystems.
    expect(cask).toContain('app "lingua.app"');
    // The app ships electron-updater, so brew must not fight it.
    expect(cask).toContain('auto_updates true');
  });

  it('pins the minimum macOS the shipped app bundle actually declares', () => {
    // `brew audit --online` compares this against LSMinimumSystemVersion
    // inside the real .app; Electron 43 builds target Monterey. Claiming a
    // lower floor would let Big Sur users install something that cannot run.
    expect(cask).toContain('depends_on macos: :monterey');
  });

  it('zaps the real bundle-id paths on uninstall', () => {
    expect(cask).toContain('~/Library/Preferences/com.lingua.app.plist');
    expect(cask).toContain('~/Library/Application Support/Lingua');
  });

  it('fails loudly when an architecture is missing from the release', () => {
    const partial = new Map([['Lingua-0.14.0-mac-arm64.dmg', ARM_SHA]]);
    expect(() => renderHomebrewCask({ version: '0.14.0', digests: partial })).toThrow(
      /Lingua-0\.14\.0-mac-x64\.dmg/
    );
  });
});

describe('renderHomebrewCliFormula', () => {
  const formula = renderHomebrewCliFormula({
    version: '1.2.0',
    digests: digestsFor('1.2.0'),
  });

  it('installs the immutable release tarball without invoking npm', () => {
    expect(formula).toContain(
      'url "https://github.com/johnny4young/lingua/releases/download/v1.2.0/linguacode-cli-1.2.0.tgz"'
    );
    expect(formula).toContain(`sha256 "${CLI_SHA}"`);
    expect(formula).not.toMatch(/npm (?:install|add)/u);
  });

  it('provides Node 24 and exposes the lingua command with that runtime on PATH', () => {
    expect(formula).toContain('depends_on "node@24"');
    expect(formula).toContain('(bin/"lingua").write_env_script');
    expect(formula).toContain('formula_opt_bin("node@24")');
  });

  it('installs native Bash, Zsh, and Fish completion files through Homebrew', () => {
    expect(formula).toContain(
      'generate_completions_from_executable(bin/"lingua", "completion")'
    );
    expect(formula).toContain('assert_path_exists bash_completion/"lingua"');
    expect(formula).toContain('assert_path_exists zsh_completion/"_lingua"');
    expect(formula).toContain('assert_path_exists fish_completion/"lingua.fish"');
  });

  it('smokes both the exact version and a real utility', () => {
    expect(formula).toContain('shell_output("#{bin}/lingua --version")');
    expect(formula).toContain(
      'pipe_output("#{bin}/lingua utility base64-encode", "hello")'
    );
  });

  it('fails loudly when the CLI archive is absent from the release', () => {
    const desktopOnly = new Map([
      ['Lingua-1.2.0-mac-arm64.dmg', ARM_SHA],
      ['Lingua-1.2.0-mac-x64.dmg', INTEL_SHA],
    ]);
    expect(() =>
      renderHomebrewCliFormula({ version: '1.2.0', digests: desktopOnly })
    ).toThrow(/linguacode-cli-1\.2\.0\.tgz/u);
  });
});

describe('renderWingetManifests', () => {
  const files = renderWingetManifests({
    version: '0.14.0',
    digests: digestsFor('0.14.0'),
    releaseDate: '2026-07-25',
  });

  it('emits exactly the three documents winget requires', () => {
    expect(Object.keys(files).sort()).toEqual(
      [
        `${WINGET_PACKAGE_IDENTIFIER}.installer.yaml`,
        `${WINGET_PACKAGE_IDENTIFIER}.locale.en-US.yaml`,
        `${WINGET_PACKAGE_IDENTIFIER}.yaml`,
      ].sort()
    );
  });

  it('stamps the same identifier, version, and schema across all three', () => {
    for (const contents of Object.values(files)) {
      expect(contents).toContain(`PackageIdentifier: ${WINGET_PACKAGE_IDENTIFIER}`);
      expect(contents).toContain('PackageVersion: 0.14.0');
      expect(contents).toContain(`ManifestVersion: ${WINGET_MANIFEST_VERSION}`);
    }
  });

  it('describes the NSIS per-user installer with an uppercase digest', () => {
    const installer = files[`${WINGET_PACKAGE_IDENTIFIER}.installer.yaml`]!;
    expect(installer).toContain('InstallerType: nullsoft');
    expect(installer).toContain('Scope: user');
    expect(installer).toContain('Architecture: x64');
    // winget's schema requires the SHA256 in uppercase.
    expect(installer).toContain(`InstallerSha256: ${WIN_SHA.toUpperCase()}`);
    expect(installer).toContain(
      'InstallerUrl: https://github.com/johnny4young/lingua/releases/download/v0.14.0/Lingua-0.14.0-win-x64.exe'
    );
    expect(installer).toContain('ReleaseDate: 2026-07-25');
  });

  it('omits ReleaseDate when it is not supplied', () => {
    const withoutDate = renderWingetManifests({
      version: '0.14.0',
      digests: digestsFor('0.14.0'),
    });
    expect(withoutDate[`${WINGET_PACKAGE_IDENTIFIER}.installer.yaml`]).not.toContain(
      'ReleaseDate:'
    );
  });

  it('carries the store metadata reviewers check', () => {
    const locale = files[`${WINGET_PACKAGE_IDENTIFIER}.locale.en-US.yaml`]!;
    expect(locale).toContain('PackageName: Lingua');
    expect(locale).toContain('Publisher: johnny4young');
    expect(locale).toContain('ManifestType: defaultLocale');
    expect(locale).toContain(
      'ReleaseNotesUrl: https://github.com/johnny4young/lingua/releases/tag/v0.14.0'
    );
  });

  it('fails loudly when the Windows installer is missing from the release', () => {
    const macOnly = new Map([
      ['Lingua-0.14.0-mac-arm64.dmg', ARM_SHA],
      ['Lingua-0.14.0-mac-x64.dmg', INTEL_SHA],
    ]);
    expect(() => renderWingetManifests({ version: '0.14.0', digests: macOnly })).toThrow(
      /Lingua-0\.14\.0-win-x64\.exe/
    );
  });
});
