import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractChangelogSection, renderReleaseNotes } from '../../scripts/release-notes.mjs';
import { pinCliVersion } from '../../scripts/pin-public-cli-version.mjs';

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Fixed',
  '- Unreleased fix.',
  '',
  '## [2.0.0] — 2026-11-01',
  '',
  '### Added',
  '- New thing.',
  '',
  '## [1.9.0] — 2026-10-01',
  '',
  '### Fixed',
  '- Old fix.',
  '',
].join('\n');

const ALL = { macos: true, windows: true, linux: true, cli: true };

describe('extractChangelogSection', () => {
  it('returns only the dated section for the version', () => {
    expect(extractChangelogSection(CHANGELOG, '2.0.0')).toBe('### Added\n- New thing.');
    expect(extractChangelogSection(CHANGELOG, '1.9.0')).toBe('### Fixed\n- Old fix.');
  });

  it('rejects a missing, undated or empty section', () => {
    expect(() => extractChangelogSection(CHANGELOG, '3.0.0')).toThrow(/no dated section/u);
    expect(() => extractChangelogSection('## [2.0.0]\n- x\n', '2.0.0')).toThrow(/no dated section/u);
    expect(() => extractChangelogSection('## [2.0.0] — 2026-11-01\n\n## [1.0.0] — 2026-01-01\n', '2.0.0')).toThrow(/empty/u);
  });

  it('does not treat a dot in the version as a wildcard', () => {
    expect(() => extractChangelogSection('## [2x0x0] — 2026-11-01\n- x\n', '2.0.0')).toThrow();
  });

  it('reads the 1.6.0 section from the real CHANGELOG', () => {
    const text = readFileSync(path.resolve(__dirname, '../../CHANGELOG.md'), 'utf8');
    expect(extractChangelogSection(text, '1.6.0')).toContain('### Added');
  });
});

describe('renderReleaseNotes', () => {
  const base = { version: '2.0.0', section: '### Added\n- New thing.' };

  it('states notarization and Authenticode only when the build used them', () => {
    const signed = renderReleaseNotes({ ...base, platforms: ALL, macNotarized: true, windowsSigned: true });
    expect(signed).toContain('Developer ID signed and notarized');
    expect(signed).toContain('Authenticode-signed NSIS installer');
    expect(signed).not.toContain('unsigned');

    const unsigned = renderReleaseNotes({ ...base, platforms: ALL, macNotarized: false, windowsSigned: false });
    expect(unsigned).toContain('ad-hoc signed preview');
    expect(unsigned).toContain('**unsigned**');
    expect(unsigned).not.toContain('Developer ID signed and notarized');
  });

  it('lists only the selected platforms and keeps the changelog body', () => {
    const notes = renderReleaseNotes({
      ...base,
      platforms: { macos: false, windows: false, linux: false, cli: true },
      macNotarized: true,
      windowsSigned: false,
    });
    expect(notes).toContain('## Lingua 2.0.0');
    expect(notes).toContain('- New thing.');
    expect(notes).toContain('/blob/v2.0.0/CHANGELOG.md');
    expect(notes).not.toMatch(/macOS|Windows|Linux|desktop updater/u);
    expect(notes).toContain('CLI archives, npm-package tarball');
  });
});

describe('pinCliVersion', () => {
  it('rewrites package.json and npm install pins and counts them', () => {
    const recipe = '"@linguacode/cli": "1.5.1"\nRUN npm install --global @linguacode/cli@1.5.1\n';
    expect(pinCliVersion(recipe, '1.6.0')).toEqual({
      text: '"@linguacode/cli": "1.6.0"\nRUN npm install --global @linguacode/cli@1.6.0\n',
      pins: 2,
    });
  });

  it('leaves unpinned installs alone and rejects a non-semver version', () => {
    expect(pinCliVersion('npm install -g @linguacode/cli\n', '1.6.0').pins).toBe(0);
    expect(() => pinCliVersion('x', 'v1.6')).toThrow(/Invalid version/u);
  });
});
