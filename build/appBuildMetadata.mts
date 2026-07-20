import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog } from '../src/shared/changelog.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(
  readFileSync(path.resolve(rootDir, 'package.json'), 'utf8')
) as { homepage?: string | null; version?: string };

function resolveWebsiteUrl() {
  return process.env.LINGUA_WEBSITE_URL || packageJson.homepage || '';
}

function resolveAppVersion() {
  return packageJson.version ?? '0.0.0';
}

function resolveChangelogJson() {
  // CHANGELOG lives at the repo root — it is a product surface (shown
  // in the in-app What's New overlay) rather than an engineering doc,
  // so it does NOT belong under docs/. Keep this path at the root.
  const markdown = readFileSync(path.resolve(rootDir, 'CHANGELOG.md'), 'utf8');
  return JSON.stringify(JSON.stringify(parseChangelog(markdown)));
}

/**
 * Defines that go into Vite's `define` block — replaced as raw
 * identifiers (`__LINGUA_BUILD_DATE__` etc.) at bundle time. These
 * read from JS code, NOT from `import.meta.env`.
 *
 * implementation adds `__LINGUA_APP_VERSION__` so the web update
 * banner can compare its build-time pin to the latest GitHub
 * release without depending on an env var being set externally.
 * Sourced from `package.json#version` so a `npm version` bump
 * automatically rolls forward.
 */
export function getSharedBuildDefines() {
  return {
    __LINGUA_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __LINGUA_WEBSITE_URL__: JSON.stringify(resolveWebsiteUrl()),
    __LINGUA_APP_VERSION__: JSON.stringify(resolveAppVersion()),
    __LINGUA_CHANGELOG_JSON__: resolveChangelogJson(),
    __LINGUA_E2E_HOOKS__: JSON.stringify(process.env.LINGUA_E2E_HOOKS === '1'),
  };
}

/**
 * `import.meta.env.VITE_*` overrides applied via `process.env` at
 * config-load time. Vite inlines these into the bundle the same way
 * `.env.production` does. implementation sets
 * `VITE_LINGUA_APP_VERSION` from `package.json#version` so the
 * existing telemetry consumer in
 * `src/renderer/utils/telemetry.ts:resolveTelemetryBase` reports the
 * real version instead of the `'0.0.0'` fallback. The value is the
 * same as `__LINGUA_APP_VERSION__` — kept as separate exports so the
 * Vite configs that don't accept defines (`define` is a build-time
 * concern, `process.env` injection happens during config evaluation)
 * can pick up either path.
 */
export function applySharedEnvDefaults() {
  if (!process.env.VITE_LINGUA_APP_VERSION) {
    process.env.VITE_LINGUA_APP_VERSION = resolveAppVersion();
  }
}
