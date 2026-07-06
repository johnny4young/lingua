#!/usr/bin/env node
/**
 * Sync content + preprocessed data from the lingua repo root into website/.
 *
 *   1. Vendor markdown files (press-kit, SEO scaffolds) into src/content/
 *   2. Preprocess ROADMAP.md → src/data/roadmap.json
 *   3. Preprocess CHANGELOG.md → src/data/changelog.json
 *   4. Read git log since the last documented release → src/data/unreleased.json
 *
 * All outputs are committed. The Astro build never reads from GitHub — it just
 * imports the JSON. CF Pages and CI work without any env vars or auth tokens.
 *
 * website/ lives INSIDE the lingua repo, so the source defaults to the repo
 * root (`..`) — no cross-repo clone, no token. LINGUA_LOCAL_PATH still
 * overrides for local experiments.
 *
 * Run:
 *   node scripts/sync-from-main.mjs            # update everything
 *   node scripts/sync-from-main.mjs --check    # diff only, exit non-zero on drift
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONTENT_DIR = join(ROOT, 'src', 'content');
const DATA_DIR = join(ROOT, 'src', 'data');
const LOCAL_BASE = resolve(process.env.LINGUA_LOCAL_PATH ?? join(ROOT, '..'));

const MANIFEST = [
  // press kit (vendored markdown)
  { from: 'docs/press-kit/launch-copy.md',       to: 'press-kit/launch-copy.md' },
  { from: 'docs/press-kit/pricing-one-pager.md', to: 'press-kit/pricing-one-pager.md' },
  { from: 'docs/press-kit/boilerplate.md',       to: 'press-kit/boilerplate.md' },
  { from: 'docs/press-kit/founder-bio.md',       to: 'press-kit/founder-bio.md' },
  { from: 'docs/press-kit/README.md',            to: 'press-kit/README.md' },
  // SEO landing scaffolds. The main repo is the English source; localized
  // translations live under sibling locale folders in this repo.
  { from: 'docs/seo-pages/go-playground-desktop.md',      to: 'seo/en/go-playground-desktop.md' },
  { from: 'docs/seo-pages/rust-code-runner-desktop.md',   to: 'seo/en/rust-code-runner-desktop.md' },
  { from: 'docs/seo-pages/python-repl-desktop.md',        to: 'seo/en/python-repl-desktop.md' },
  { from: 'docs/seo-pages/typescript-playground-offline.md', to: 'seo/en/typescript-playground-offline.md' },
  { from: 'docs/seo-pages/multi-language-code-runner.md', to: 'seo/en/multi-language-code-runner.md' },
  { from: 'docs/seo-pages/lua-offline-playground.md',     to: 'seo/en/lua-offline-playground.md' },
];

// ────────────────────────────────────────────────────────────────────────────
// Generic helpers
// ────────────────────────────────────────────────────────────────────────────

async function readSource(relPath) {
  const path = join(LOCAL_BASE, relPath);
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Source not found: ${path}\nSet LINGUA_LOCAL_PATH or check that the lingua repo lives next to this one.`);
    }
    throw err;
  }
}

// Like readSource, but returns null when the file is absent — for sources that
// are intentionally local-only in the (now public) lingua repo (its .gitignore
// keeps docs/ROADMAP.md, docs/PLAN.md, etc. out of the public tree).
async function readSourceOptional(relPath) {
  try {
    return await readFile(join(LOCAL_BASE, relPath), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readExisting(absPath) {
  try {
    return await readFile(absPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeIfChanged(absPath, content, { check }) {
  const existing = await readExisting(absPath);
  if (existing === content) return 'unchanged';
  if (check) return existing == null ? 'missing' : 'drift';
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, 'utf8');
  return existing == null ? 'created' : 'updated';
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 1 — vendor markdown
// ────────────────────────────────────────────────────────────────────────────

async function syncManifest({ check }) {
  const out = [];
  for (const entry of MANIFEST) {
    const src = await readSource(entry.from);
    const dest = join(CONTENT_DIR, entry.to);
    const action = await writeIfChanged(dest, src, { check });
    out.push({ kind: 'content', name: entry.to, action });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 — preprocess ROADMAP.md → roadmap.json
// ────────────────────────────────────────────────────────────────────────────

const SUBSECTION_RE = /^###\s+4([a-j])\.\s+(.+?)\s*(?:\((.+?)\))?\s*$/;
const TABLE_ROW_RE = /^\|\s*\[`(RL-\d+)`\]\([^)]+\)\s*\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/;
const SECTION_4_RE = /^##\s+4\.\s+/;
const SECTION_NEXT_RE = /^##\s+\d+\.\s+/;

const THEME_LABELS = {
  a: 'Launch',
  b: 'Editor & runtime',
  c: 'Languages',
  d: 'Execution & tooling',
  e: 'Developer utilities',
  f: 'Launch operations',
  g: 'Personalization & polish',
  h: 'Documentation',
  i: 'Security & quality',
  j: 'Research', // skipped from output
};

function trimScopeForUsers(scope) {
  let out = scope.replace(/\((?:Slice|Phase|Stage)[^)]*shipped[^)]*\)\.?/gi, '');
  out = out.replace(/Shipped\s*[—:-]\s*[^.]+\.?/gi, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function parseRoadmap(text) {
  const lines = text.split('\n');
  const groups = [];
  let inSection4 = false;
  let currentGroup = null;

  for (const line of lines) {
    if (SECTION_4_RE.test(line)) { inSection4 = true; continue; }
    if (inSection4 && SECTION_NEXT_RE.test(line) && !SECTION_4_RE.test(line)) break;
    if (!inSection4) continue;

    const subMatch = line.match(SUBSECTION_RE);
    if (subMatch) {
      const themeKey = subMatch[1];
      const friendly = THEME_LABELS[themeKey] ?? subMatch[2];
      if (friendly === 'Research') { currentGroup = null; continue; }
      currentGroup = { theme: friendly, items: [] };
      groups.push(currentGroup);
      continue;
    }

    const rowMatch = line.match(TABLE_ROW_RE);
    if (rowMatch && currentGroup) {
      const [, id, title, statusRaw, scopeRaw] = rowMatch;
      currentGroup.items.push({
        id,
        title: title.trim(),
        scope: trimScopeForUsers(scopeRaw),
        status: statusRaw.trim(),
        theme: currentGroup.theme,
      });
    }
  }
  return groups.filter((g) => g.items.length > 0);
}

function bucketByStatus(groups, status) {
  return groups
    .map((g) => ({ theme: g.theme, items: g.items.filter((i) => i.status === status) }))
    .filter((g) => g.items.length > 0);
}

async function preprocessRoadmap({ check }) {
  const text = await readSourceOptional('docs/ROADMAP.md');
  if (text === null) {
    // docs/ROADMAP.md is intentionally local-only in the (now public) lingua
    // repo (see its .gitignore). Keep the existing roadmap.json and let the
    // rest of the sync (changelog, press-kit, SEO) proceed, instead of failing
    // the whole run. A future slice can parse the public ROADMAP_2026_H2.md.
    console.log('[sync] docs/ROADMAP.md not present (local-only) — keeping existing roadmap.json');
    return [];
  }
  const all = parseRoadmap(text);
  if (all.length === 0) throw new Error('ROADMAP.md parsed to zero groups — check format');
  const planned = bucketByStatus(all, 'Planned');
  const inProgress = bucketByStatus(all, 'Partial');
  const data = {
    generatedAt: new Date().toISOString(),
    totals: {
      planned: planned.reduce((acc, g) => acc + g.items.length, 0),
      inProgress: inProgress.reduce((acc, g) => acc + g.items.length, 0),
    },
    planned,
    inProgress,
  };
  const action = await writeIfChanged(join(DATA_DIR, 'roadmap.json'), JSON.stringify(data, null, 2) + '\n', { check });
  return [{ kind: 'data', name: 'roadmap.json', action }];
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 3 — preprocess CHANGELOG.md → changelog.json
// ────────────────────────────────────────────────────────────────────────────

const CL_HEADING_RE = /^##\s+\[v?(\d+\.\d+\.\d+)\]\s+[—-]\s+(\d{4}-\d{2}-\d{2})\s*$/;
const CL_SECTION_RE = /^###\s+(.+?)\s*$/;
const CL_BULLET_RE = /^-\s+(.*)$/;

/**
 * Tiny inline-markdown renderer for CHANGELOG bullets. Handles bold (`**…**`),
 * inline code (backticks) and `[text](url)` links. Anything else is left as
 * literal text. Order matters — code first so `**` inside backticks doesn't
 * get treated as bold.
 */
function inlineMd(s) {
  // Escape HTML
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Inline code: `...`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: **...**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  return out;
}

function parseChangelog(text) {
  const lines = text.split('\n');
  const entries = [];
  let current = null;
  let currentSection = null;
  let rawLines = [];

  for (const line of lines) {
    const headingMatch = line.match(CL_HEADING_RE);
    if (headingMatch) {
      if (current) { current.raw = rawLines.join('\n').trim(); entries.push(current); }
      current = { version: headingMatch[1], date: headingMatch[2], sections: [], raw: '' };
      currentSection = null;
      rawLines = [];
      continue;
    }
    if (!current) continue;

    const sectionMatch = line.match(CL_SECTION_RE);
    if (sectionMatch) {
      currentSection = { heading: sectionMatch[1], items: [] };
      current.sections.push(currentSection);
      rawLines.push(line);
      continue;
    }

    const bulletMatch = line.match(CL_BULLET_RE);
    if (bulletMatch && currentSection) {
      currentSection.items.push(inlineMd(bulletMatch[1]));
    }
    rawLines.push(line);
  }
  if (current) { current.raw = rawLines.join('\n').trim(); entries.push(current); }
  return entries;
}

async function preprocessChangelog({ check }) {
  const text = await readSource('CHANGELOG.md');
  const entries = parseChangelog(text);
  if (entries.length === 0) throw new Error('CHANGELOG.md parsed to zero entries — check format');
  const data = { generatedAt: new Date().toISOString(), entries };
  const action = await writeIfChanged(join(DATA_DIR, 'changelog.json'), JSON.stringify(data, null, 2) + '\n', { check });
  return [{ kind: 'data', name: 'changelog.json', action }];
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 4 — git log → unreleased.json
// ────────────────────────────────────────────────────────────────────────────

const VISIBLE_TYPES = new Set(['feat', 'fix', 'perf']);
const TYPE_LABELS = { feat: 'New', fix: 'Fix', perf: 'Performance' };

function git(args) {
  return execFileSync('git', ['-C', LOCAL_BASE, ...args], { encoding: 'utf8' }).trim();
}

function semverCompare(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function parseCommitSubject(subject) {
  // Conventional commits: `type(scope): subject` or `type: subject`
  const m = subject.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/);
  if (!m) return null;
  const [, type, scope, , msg] = m;
  return { type, scope: scope ?? null, breaking: subject.includes('!:'), message: msg };
}

function chooseBaseRef() {
  // Prefer the highest existing semver tag.
  let tags = [];
  try {
    tags = git(['tag', '-l']).split('\n').filter((t) => /^v?\d+\.\d+\.\d+$/.test(t));
  } catch {
    return null;
  }
  if (tags.length === 0) return null;
  tags.sort(semverCompare);
  return tags[tags.length - 1];
}

async function preprocessUnreleased({ check }) {
  const baseRef = chooseBaseRef();
  let raw = '';
  if (baseRef) {
    try {
      raw = git(['log', `${baseRef}..HEAD`, '--pretty=format:%H%x09%cI%x09%s']);
    } catch (err) {
      console.warn(`[sync] git log against ${baseRef} failed: ${err.message}. Falling back to last 30 commits.`);
      raw = git(['log', '-30', '--pretty=format:%H%x09%cI%x09%s']);
    }
  } else {
    raw = git(['log', '-30', '--pretty=format:%H%x09%cI%x09%s']);
  }

  const allCommits = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, dateIso, subject] = line.split('\t');
      const parsed = parseCommitSubject(subject);
      return { hash: hash.slice(0, 7), date: dateIso, subject, parsed };
    });

  // Keep only user-visible commits with conventional types we want to surface,
  // and skip noise (infra-only scope like `(infra)` or `(ci)` even if "feat:")
  const visible = allCommits
    .filter((c) => c.parsed && VISIBLE_TYPES.has(c.parsed.type))
    .filter((c) => {
      const scope = c.parsed.scope ?? '';
      return !/^(infra|ci|build|test)$/i.test(scope);
    })
    .slice(0, 12)
    .map((c) => ({
      hash: c.hash,
      date: c.date.slice(0, 10),
      type: c.parsed.type,
      typeLabel: TYPE_LABELS[c.parsed.type] ?? c.parsed.type,
      scope: c.parsed.scope,
      message: c.parsed.message,
      breaking: c.parsed.breaking,
    }));

  const data = {
    generatedAt: new Date().toISOString(),
    baseRef,
    commitCount: visible.length,
    totalSinceBase: allCommits.length,
    commits: visible,
  };
  const action = await writeIfChanged(join(DATA_DIR, 'unreleased.json'), JSON.stringify(data, null, 2) + '\n', { check });
  return [{ kind: 'data', name: 'unreleased.json', action }];
}

// ────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const check = process.argv.includes('--check');
  console.log(`[sync] LINGUA_LOCAL_PATH=${LOCAL_BASE} mode=${check ? 'check' : 'write'}`);

  const results = [];
  try {
    results.push(...(await syncManifest({ check })));
    results.push(...(await preprocessRoadmap({ check })));
    results.push(...(await preprocessChangelog({ check })));
    results.push(...(await preprocessUnreleased({ check })));
  } catch (err) {
    console.error(`[sync] FAILED: ${err.message}`);
    process.exit(2);
  }

  for (const r of results) {
    const flag = r.action === 'unchanged' ? ' ' : (r.action === 'drift' || r.action === 'missing') ? '!' : '+';
    console.log(`  ${flag} ${r.kind.padEnd(7)}  ${r.name.padEnd(48)}  ${r.action}`);
  }

  if (check) {
    const drifted = results.filter((r) => r.action === 'drift' || r.action === 'missing');
    if (drifted.length > 0) {
      console.error(`\n[sync] ${drifted.length} file(s) out of sync. Run \`npm run sync:content\` to update.`);
      process.exit(1);
    }
    console.log('\n[sync] Everything in sync.');
  } else {
    const changed = results.filter((r) => r.action !== 'unchanged');
    console.log(`\n[sync] ${changed.length} file(s) changed.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
