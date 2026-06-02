#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';

export const CHANGELOG_SECTIONS = [
  'Added',
  'Changed',
  'Fixed',
  'Security',
  'Removed',
  'Deprecated',
];

function runGit(args, { cwd = process.cwd() } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function parseConventionalSubject(subject) {
  const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/u);
  if (!match) return null;
  return {
    type: match[1],
    scope: match[2] ?? null,
    breaking: Boolean(match[3]),
    description: match[4],
  };
}

/**
 * Parse `git log --format=%H%x1f%s%x1f%b%x1e` output into records without
 * trusting newlines as separators. The unit/record separators keep multiline
 * commit bodies intact so `Changelog:` trailers can still be read.
 */
export function parseCommitLog(raw) {
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', subject = '', body = ''] = record.split('\x1f');
      return {
        hash,
        shortHash: hash.slice(0, 7),
        subject,
        body,
      };
    });
}

function parseChangelogTrailer(body) {
  const lines = body.split(/\r?\n/u);
  for (const line of lines) {
    const match = line.match(
      /^Changelog:\s*(none|skip|Added|Changed|Fixed|Security|Removed|Deprecated)(?:\s*[-:]\s*(.+))?\s*$/iu
    );
    if (!match) continue;
    const section = match[1].toLowerCase();
    if (section === 'none' || section === 'skip') {
      return { include: false };
    }
    const normalized = CHANGELOG_SECTIONS.find(
      (candidate) => candidate.toLowerCase() === section
    );
    return {
      include: true,
      section: normalized,
      text: match[2]?.trim() ?? null,
    };
  }
  return null;
}

function defaultSectionFor(parsed) {
  if (!parsed) return null;
  if (parsed.breaking) return 'Changed';
  if (parsed.type === 'feat') return 'Added';
  if (parsed.type === 'fix') return 'Fixed';
  if (parsed.type === 'perf') return 'Changed';
  if (parsed.type === 'security') return 'Security';
  if (parsed.type === 'chore' && parsed.scope === 'security') return 'Security';
  return null;
}

function cleanDescription(description) {
  return description
    .replace(/\bRL-\d+\b\s*/gu, '')
    .replace(/\bSlice\s+\d+(?:\.\d+)?\b\s*[-:—]?\s*/giu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()
    .replace(/^[-:—]\s*/u, '');
}

/**
 * Convert one conventional commit into a public changelog item.
 *
 * Commit bodies can opt out with `Changelog: none` / `skip`, or override both
 * section and public copy with `Changelog: Added - ...`. Without a trailer, the
 * classifier includes only user-facing conventional types and strips internal
 * RL/slice prefixes from the subject.
 */
export function classifyCommit(commit) {
  const parsed = parseConventionalSubject(commit.subject);
  const trailer = parseChangelogTrailer(commit.body);

  if (trailer?.include === false) {
    return null;
  }

  const section = trailer?.section ?? defaultSectionFor(parsed);
  if (!section) {
    return null;
  }

  const text =
    trailer?.text ??
    cleanDescription(parsed?.description ?? commit.subject);

  if (!text) {
    return null;
  }

  return {
    section,
    text,
    hash: commit.shortHash,
    subject: commit.subject,
  };
}

export function groupChangelogItems(commits) {
  const grouped = Object.fromEntries(CHANGELOG_SECTIONS.map((section) => [section, []]));
  for (const commit of commits) {
    const item = classifyCommit(commit);
    if (item) {
      grouped[item.section].push(item);
    }
  }
  return grouped;
}

/**
 * Render a release-note draft for human editing. This intentionally keeps
 * commit hashes beside each bullet so reviewers can trace every suggested line
 * back to the source commit before copying it into `CHANGELOG.md`.
 */
export function renderChangelogDraft({ commits, from, to, generatedAt = new Date() }) {
  const grouped = groupChangelogItems(commits);
  const lines = [
    '# Changelog draft',
    '',
    `Range: \`${from ? `${from}..${to}` : to}\``,
    `Generated: ${generatedAt.toISOString()}`,
    '',
  ];

  let wroteAny = false;
  for (const section of CHANGELOG_SECTIONS) {
    const items = grouped[section];
    if (items.length === 0) continue;
    wroteAny = true;
    lines.push(`## ${section}`, '');
    for (const item of items) {
      lines.push(`- ${item.text} (${item.hash})`);
    }
    lines.push('');
  }

  if (!wroteAny) {
    lines.push('No user-facing conventional commits found.', '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Collect commits for either `<latest-tag>..HEAD` or a caller-provided range.
 * `changelog:check` reuses this helper so both drafting and release validation
 * classify exactly the same commit stream.
 */
export function collectGitCommits({ from, to = 'HEAD', cwd = process.cwd() } = {}) {
  const range = from ? `${from}..${to}` : to;
  const raw = runGit(['log', '--format=%H%x1f%s%x1f%b%x1e', range], { cwd });
  return parseCommitLog(raw);
}

export function resolveLatestTag({ cwd = process.cwd() } = {}) {
  try {
    return runGit(['describe', '--tags', '--abbrev=0'], { cwd });
  } catch {
    return '';
  }
}

function printHelp() {
  console.log(`Usage: pnpm run changelog:draft -- [--from <ref>] [--to <ref>]

Generate a markdown draft from conventional commits. Commits can opt out with
"Changelog: none" or provide public copy with "Changelog: Added - ...".`);
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      from: { type: 'string' },
      to: { type: 'string', default: 'HEAD' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const from = values.from ?? resolveLatestTag({ cwd });
  const commits = collectGitCommits({ from, to: values.to, cwd });
  process.stdout.write(renderChangelogDraft({ commits, from, to: values.to }));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
