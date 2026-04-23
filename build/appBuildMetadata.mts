import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog } from '../src/shared/changelog.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(
  readFileSync(path.resolve(rootDir, 'package.json'), 'utf8')
) as { homepage?: string | null };

function resolveWebsiteUrl() {
  return process.env.LINGUA_WEBSITE_URL || packageJson.homepage || '';
}

function resolveChangelogJson() {
  // CHANGELOG lives at the repo root — it is a product surface (shown
  // in the in-app What's New overlay) rather than an engineering doc,
  // so it does NOT belong under docs/. Keep this path at the root.
  const markdown = readFileSync(path.resolve(rootDir, 'CHANGELOG.md'), 'utf8');
  return JSON.stringify(JSON.stringify(parseChangelog(markdown)));
}

export function getSharedBuildDefines() {
  return {
    __LINGUA_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __LINGUA_WEBSITE_URL__: JSON.stringify(resolveWebsiteUrl()),
    __LINGUA_CHANGELOG_JSON__: resolveChangelogJson(),
  };
}
