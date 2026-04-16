import { describe, expect, it } from 'vitest';
import { getFeaturedChangelogEntry, parseChangelog } from '../../src/shared/changelog';

const SAMPLE_CHANGELOG = `# Changelog

## [Unreleased] — 2026-04-16

### Added
- New command palette action

## [0.1.0] — 2026-04-16

### Added
- Initial release

### Fixed
- Minor bug fix
`;

describe('changelog helpers', () => {
  it('parses keep-a-changelog headings into structured entries', () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      version: 'Unreleased',
      unreleased: true,
      sections: [{ title: 'Added', items: ['New command palette action'] }],
    });
    expect(entries[1]?.sections[1]).toMatchObject({
      title: 'Fixed',
      items: ['Minor bug fix'],
    });
  });

  it('creates a fallback Notes section for bullets before any subsection header', () => {
    const entries = parseChangelog(`# Changelog

## [0.1.1] — 2026-04-17
- Hotfix shipped
`);

    expect(entries).toEqual([
      {
        version: '0.1.1',
        date: '2026-04-17',
        unreleased: false,
        sections: [{ title: 'Notes', items: ['Hotfix shipped'] }],
      },
    ]);
  });

  it('prefers the current app version when choosing the featured entry', () => {
    const entries = parseChangelog(SAMPLE_CHANGELOG);

    expect(getFeaturedChangelogEntry(entries, '0.1.0')?.version).toBe('0.1.0');
    expect(getFeaturedChangelogEntry(entries, '9.9.9')?.version).toBe('0.1.0');
  });
});
