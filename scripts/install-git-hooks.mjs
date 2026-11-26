#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';

import { isDirectInvocation } from './lib/isDirectInvocation.mjs';

export const HOOKS_PATH = '.githooks';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** Points core.hooksPath at the versioned hooks unless CI or a custom path owns it. */
export function installGitHooks({ cwd = process.cwd(), env = process.env, run = git } = {}) {
  if (env.CI) return 'skipped: CI';
  try {
    if (run(['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') return 'skipped: not a git work tree';
  } catch {
    return 'skipped: not a git work tree';
  }
  let current = '';
  try {
    current = run(['config', '--get', 'core.hooksPath'], cwd);
  } catch {
    // Unset: git exits 1.
  }
  if (current === HOOKS_PATH) return 'already installed';
  if (current) return `skipped: core.hooksPath is ${current}`;
  run(['config', 'core.hooksPath', HOOKS_PATH], cwd);
  return 'installed';
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const status = installGitHooks();
    if (status !== 'already installed') console.log(`git hooks: ${status}`);
  } catch (error) {
    console.warn(`git hooks: not installed (${error.message})`);
  }
}
