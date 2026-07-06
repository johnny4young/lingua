#!/usr/bin/env node
/**
 * One-shot: sync content from the local lingua sibling, then commit any
 * changes under src/content/ and src/data/. Optionally push.
 *
 *   npm run sync:commit          # sync + commit only
 *   npm run sync:push            # sync + commit + push
 *
 * The commit message includes today's date and a summary of what changed
 * (markdown vs data, file count). Exits cleanly when there is nothing new.
 *
 * Designed for local use. CI uses the same `sync-from-main.mjs` script
 * with a PR-creator action — see `.github/workflows/sync-content.yml`.
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const shouldPush = process.argv.includes('--push');

const SYNC_PATHS = ['src/content', 'src/data'];

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
}

function porcelainFor(paths) {
  return git('status', '--porcelain', '--', ...paths);
}

function summarizeChanges(porcelain) {
  const lines = porcelain.split('\n').filter(Boolean);
  let content = 0, data = 0;
  for (const line of lines) {
    const path = line.slice(3);
    if (path.startsWith('src/content/')) content += 1;
    else if (path.startsWith('src/data/')) data += 1;
  }
  const parts = [];
  if (content > 0) parts.push(`${content} content file${content === 1 ? '' : 's'}`);
  if (data > 0) parts.push(`${data} data file${data === 1 ? '' : 's'}`);
  return parts.join(', ') || `${lines.length} files`;
}

function ensureCleanWorktree() {
  // Refuse to start if there's anything under SYNC_PATHS already pending —
  // we don't want to accidentally bundle unrelated edits into the sync commit.
  const dirty = porcelainFor(SYNC_PATHS);
  if (dirty) {
    console.error('[sync-and-push] Aborted — uncommitted changes already exist under src/content/ or src/data/:');
    console.error(dirty);
    console.error('Commit, stash, or revert them first.');
    process.exit(2);
  }
}

console.log(`[sync-and-push] mode=${shouldPush ? 'sync+commit+push' : 'sync+commit'}`);
ensureCleanWorktree();

console.log('\n[sync-and-push] running sync…');
run('node', ['scripts/sync-from-main.mjs']);

const porcelain = porcelainFor(SYNC_PATHS);
if (!porcelain) {
  console.log('\n[sync-and-push] No changes — already in sync.');
  process.exit(0);
}

console.log(`\n[sync-and-push] Changes:\n${porcelain}`);

git('add', '--', ...SYNC_PATHS);

const today = new Date().toISOString().slice(0, 10);
const summary = summarizeChanges(porcelain);
const commitMessage = `sync: refresh content from lingua@main (${today}) — ${summary}`;

run('git', ['commit', '-m', commitMessage]);
console.log('\n[sync-and-push] Commit created.');

if (shouldPush) {
  console.log('[sync-and-push] Pushing…');
  run('git', ['push']);
  console.log('[sync-and-push] Pushed.');
} else {
  console.log('[sync-and-push] Skipping push (use `npm run sync:push` to also push).');
}
