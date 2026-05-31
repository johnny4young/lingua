import { describe, expect, it, vi } from 'vitest';

import {
  classifyCommit,
  main as draftMain,
  parseCommitLog,
  renderChangelogDraft,
} from '../../scripts/changelog-draft.mjs';
import {
  main as checkMain,
  validateChangelogState,
} from '../../scripts/changelog-check.mjs';
import { stripArgSeparator } from '../../scripts/lib/cli-args.mjs';

describe('changelog automation scripts', () => {
  it('parses git log records and groups conventional commits into a draft', () => {
    const commits = parseCommitLog(
      [
        '1111111111111111111111111111111111111111\x1ffeat(ui): add profile backup\x1f\x1e',
        '2222222222222222222222222222222222222222\x1ffix(main): stop leaking watcher ids\x1f\x1e',
        '3333333333333333333333333333333333333333\x1fdocs: refresh wording\x1fChangelog: none\x1e',
      ].join('')
    );

    const draft = renderChangelogDraft({
      commits,
      from: 'v0.2.3',
      to: 'HEAD',
      generatedAt: new Date('2026-05-07T00:00:00.000Z'),
    });

    expect(draft).toContain('## Added');
    expect(draft).toContain('- add profile backup (1111111)');
    expect(draft).toContain('## Fixed');
    expect(draft).toContain('- stop leaking watcher ids (2222222)');
    expect(draft).not.toContain('refresh wording');
  });

  it('lets explicit Changelog trailers override the default section and copy', () => {
    const item = classifyCommit({
      hash: '4444444444444444444444444444444444444444',
      shortHash: '4444444',
      subject: 'chore(security): rotate release keys',
      body: 'Changelog: Security - Rotated release signing material.',
    });

    expect(item).toMatchObject({
      section: 'Security',
      text: 'Rotated release signing material.',
    });
  });

  it('fails when package.json is behind the latest git tag', () => {
    const result = validateChangelogState({
      packageVersion: '0.2.2',
      latestTag: 'v0.2.3',
      changelogText: '## [0.2.2] — 2026-05-07\n',
      commitsSinceLatestTag: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('newer than package.json version');
  });

  it('requires a top changelog entry for user-facing commits since the latest tag', () => {
    const result = validateChangelogState({
      packageVersion: '0.2.3',
      latestTag: 'v0.2.3',
      changelogText: '## [0.2.3] — 2026-04-30\n',
      commitsSinceLatestTag: [
        {
          hash: '5555555555555555555555555555555555555555',
          shortHash: '5555555',
          subject: 'feat(settings): add profile backup',
          body: '',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('need a new CHANGELOG.md release entry');
  });

  it('passes when the top changelog entry and package version are ahead of the latest tag', () => {
    const result = validateChangelogState({
      packageVersion: '0.2.4',
      latestTag: 'v0.2.3',
      changelogText: '## [0.2.4] — 2026-05-07\n',
      commitsSinceLatestTag: [
        {
          hash: '6666666666666666666666666666666666666666',
          shortHash: '6666666',
          subject: 'feat(settings): add profile backup',
          body: '',
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it('requires release automation to match the requested tag exactly', () => {
    const result = validateChangelogState({
      packageVersion: '0.2.5',
      latestTag: 'v0.2.4',
      releaseTag: 'v0.2.4',
      changelogText: '## [0.2.5] — 2026-05-07\n',
      commitsSinceLatestTag: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(
      'package.json version (0.2.5) must match release tag (v0.2.4)'
    );
    expect(result.errors.join('\n')).toContain(
      'CHANGELOG.md top release (0.2.5) must match release tag (v0.2.4)'
    );
  });

  it('passes release automation when package, changelog, and tag match', () => {
    const result = validateChangelogState({
      packageVersion: '0.2.4',
      latestTag: 'v0.2.4',
      releaseTag: 'v0.2.4',
      changelogText: '## [0.2.4] — 2026-05-07\n',
      commitsSinceLatestTag: [],
    });

    expect(result.ok).toBe(true);
  });

  it('allows non-version refs for the commit range while keeping release tags strict', () => {
    const result = validateChangelogState({
      packageVersion: '0.2.4',
      latestTag: 'HEAD',
      releaseTag: 'v0.2.4',
      changelogText: '## [0.2.4] — 2026-05-07\n',
      commitsSinceLatestTag: [],
    });

    expect(result.ok).toBe(true);
  });
});

describe('pnpm argument-separator handling', () => {
  it('strips a leading -- so pnpm-forwarded flags reach parseArgs', () => {
    expect(
      stripArgSeparator(['--', '--release-tag', 'v0.5.0', '--from', 'v0.5.0'])
    ).toEqual(['--release-tag', 'v0.5.0', '--from', 'v0.5.0']);
  });

  it('is a no-op for npm-style argv that already dropped the separator', () => {
    expect(stripArgSeparator(['--release-tag', 'v0.5.0'])).toEqual([
      '--release-tag',
      'v0.5.0',
    ]);
  });

  it('removes every standalone -- token without touching flags or values', () => {
    expect(stripArgSeparator(['--', '--a', 'one', '--', '--b'])).toEqual([
      '--a',
      'one',
      '--b',
    ]);
  });

  // Regression for the v0.5.0 release: the Release workflow invokes
  // `pnpm run changelog:check -- --release-tag <tag> --from <tag>`, and
  // pnpm 11 forwards the `--` into argv. Before the fix this threw
  // ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL inside parseArgs. Using --help
  // keeps the assertion hermetic (no git/fs/version coupling).
  it('lets changelog-check main tolerate the pnpm-forwarded -- separator', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(() => checkMain(['--', '--help'])).not.toThrow();
      expect(checkMain(['--', '--help'])).toBe(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('lets changelog-draft main tolerate the pnpm-forwarded -- separator', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(() => draftMain(['--', '--help'])).not.toThrow();
      expect(draftMain(['--', '--help'])).toBe(0);
    } finally {
      logSpy.mockRestore();
    }
  });
});
