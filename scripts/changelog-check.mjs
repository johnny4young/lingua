#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  classifyCommit,
  collectGitCommits,
  resolveLatestTag,
} from './changelog-draft.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function stripTagPrefix(value) {
  return value.replace(/^v/u, '');
}

export function parseVersion(value) {
  const normalized = stripTagPrefix(value.trim());
  if (!/^\d+\.\d+\.\d+$/u.test(normalized)) {
    throw new Error(`Invalid version "${value}". Expected MAJOR.MINOR.PATCH.`);
  }
  return normalized.split('.').map((part) => Number(part));
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

export function parseTopChangelogVersion(changelogText) {
  const match = changelogText.match(/^## \[([^\]]+)\]\s+—\s+\d{4}-\d{2}-\d{2}/mu);
  return match?.[1] ?? null;
}

export function validateChangelogState({
  packageVersion,
  changelogText,
  latestTag = '',
  commitsSinceLatestTag = [],
}) {
  const errors = [];
  const topVersion = parseTopChangelogVersion(changelogText);
  const userFacingCommits = commitsSinceLatestTag
    .map((commit) => classifyCommit(commit))
    .filter(Boolean);

  try {
    parseVersion(packageVersion);
  } catch (error) {
    errors.push(error.message);
  }

  if (!topVersion) {
    errors.push('CHANGELOG.md is missing a top release heading.');
  } else if (topVersion !== packageVersion) {
    errors.push(
      `CHANGELOG.md top release (${topVersion}) must match package.json version (${packageVersion}).`
    );
  }

  if (latestTag) {
    try {
      if (compareVersions(latestTag, packageVersion) > 0) {
        errors.push(
          `Latest git tag (${latestTag}) is newer than package.json version (${packageVersion}).`
        );
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (latestTag && topVersion) {
    try {
      const changelogIsAheadOfTag = compareVersions(topVersion, latestTag) > 0;
      if (userFacingCommits.length > 0 && !changelogIsAheadOfTag) {
        errors.push(
          `${userFacingCommits.length} user-facing commit(s) since ${latestTag} need a new CHANGELOG.md release entry or "Changelog: none".`
        );
      }
    } catch {
      // Version-format errors were already collected above.
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    topVersion,
    userFacingCommitCount: userFacingCommits.length,
  };
}

function printHelp() {
  console.log(`Usage: npm run changelog:check -- [--from <ref>] [--to <ref>]

Checks that package.json, CHANGELOG.md, and the latest tag are not drifting.
Use "Changelog: none" in a commit body for explicit non-user-facing fixes.`);
}

export function main(argv = process.argv.slice(2), { cwd = repoRoot } = {}) {
  const { values } = parseArgs({
    args: argv,
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

  const latestTag = values.from ?? resolveLatestTag({ cwd });
  const packageJson = JSON.parse(
    readFileSync(path.join(cwd, 'package.json'), 'utf8')
  );
  const changelogText = readFileSync(path.join(cwd, 'CHANGELOG.md'), 'utf8');
  const commitsSinceLatestTag = latestTag
    ? collectGitCommits({ from: latestTag, to: values.to, cwd })
    : [];
  const result = validateChangelogState({
    packageVersion: packageJson.version,
    changelogText,
    latestTag,
    commitsSinceLatestTag,
  });

  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`changelog: ${error}`);
    }
    return 1;
  }

  console.log(
    `changelog: ok (package ${packageJson.version}, top release ${result.topVersion}, ${result.userFacingCommitCount} user-facing commit(s) since ${latestTag || 'repository start'})`
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
