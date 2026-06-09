#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { isLinguaDarwinZipAsset } from './lib/darwinAsset.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_BASE_URL = 'https://updates.linguacode.dev';
export const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'output', 'update-feed-validation');
export const DEFAULT_PLATFORMS = ['darwin', 'win32'];
const SUPPORTED_PLATFORMS = new Set(DEFAULT_PLATFORMS);

function normalizeVersion(version) {
  if (typeof version !== 'string') return null;
  const normalized = version.startsWith('v') ? version.slice(1) : version;
  return /^\d+\.\d+\.\d+$/u.test(normalized) ? normalized : null;
}

/**
 * Collapse repeated `--platform` flags into the canonical validation order while
 * rejecting values the update server does not serve. Linux is intentionally
 * absent: Electron's built-in updater only has darwin/win32 release-feed
 * contracts today.
 */
function parsePlatforms(value) {
  const values = Array.isArray(value) ? value : value ? [value] : DEFAULT_PLATFORMS;
  const platforms = [];
  for (const platform of values) {
    if (!SUPPORTED_PLATFORMS.has(platform)) {
      throw new Error(`Unsupported platform "${platform}". Expected darwin or win32.`);
    }
    if (!platforms.includes(platform)) platforms.push(platform);
  }
  return platforms;
}

/**
 * Build the exact update-feed probe URL without trusting caller-provided path
 * fragments. Staging feeds may point at localhost; every other target must be
 * HTTPS because release validation fetches signed update metadata and should
 * never exercise a downgrade path.
 */
function resolveFeedUrl(baseUrl, platform, oldVersion) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid --base-url: ${baseUrl}`);
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('--base-url must use https unless it targets localhost.');
  }
  const trimmed = parsed.toString().replace(/\/+$/u, '');
  return `${trimmed}/update/${encodeURIComponent(platform)}/${encodeURIComponent(oldVersion)}`;
}

/**
 * Best-effort extraction of the darwin ZIP filename from a (possibly signed)
 * download URL. Returns the basename only when it looks like a darwin `.zip`
 * asset, so opaque signed URLs that drop the filename are skipped rather than
 * failed. Lets the live-feed checker apply the same filename contract the
 * release-time guard enforces pre-publish.
 *
 * @param {string} url
 * @returns {string | null}
 */
function extractDarwinAssetName(url) {
  let base;
  try {
    const { pathname } = new URL(url);
    // decodeURIComponent can throw on a stray `%` that `new URL` left intact,
    // so keep it inside the best-effort guard — a weird URL skips the filename
    // check and falls back to the version-reference check, never crashes.
    base = decodeURIComponent(pathname.split('/').pop() ?? '');
  } catch {
    return null;
  }
  const lower = base.toLowerCase();
  return lower.endsWith('.zip') && lower.includes('darwin') ? base : null;
}

/**
 * Validate the Squirrel.Mac JSON shape returned by `GET /update/darwin/*`.
 * The checker records human-readable evidence instead of downloading the asset;
 * release workflow checksum and mirror jobs verify payload bytes.
 */
export function validateDarwinPayload(payload, expectedVersion = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('darwin update payload must be a JSON object.');
  }
  const url = payload.url;
  const name = payload.name;
  const pubDate = payload.pub_date;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('darwin update payload is missing url.');
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('darwin update payload is missing name.');
  }
  if (typeof pubDate !== 'string') {
    throw new Error('darwin update payload is missing pub_date.');
  }
  if (expectedVersion && !name.includes(expectedVersion) && !url.includes(expectedVersion)) {
    throw new Error(`darwin update payload does not reference ${expectedVersion}.`);
  }
  // RL-139 — when the signed URL still carries the asset filename, assert it
  // honors the darwin update-asset contract shared with the release-time guard
  // (scripts/lib/darwinAsset.mjs). Opaque signed URLs without a filename fall
  // back to the version-reference check above.
  if (expectedVersion) {
    const assetName = extractDarwinAssetName(url);
    if (assetName && !isLinguaDarwinZipAsset(assetName, expectedVersion)) {
      throw new Error(
        `darwin update asset ${assetName} does not match the update-feed filename contract for ${expectedVersion}.`
      );
    }
  }
  return { versionEvidence: name, assetEvidence: url };
}

/**
 * Validate Windows Squirrel RELEASES text after it has been rewritten through
 * the update server's `/download/<id>/<asset>` proxy. Raw GitHub asset names
 * are rejected because private-repo release assets are not public-downloadable.
 */
export function validateWin32Payload(text, expectedVersion = null) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('win32 RELEASES payload is empty.');
  }
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const parts = line.split(/\s+/u);
    if (parts.length < 3) {
      throw new Error(`Malformed RELEASES line: ${line}`);
    }
    let downloadUrl;
    try {
      downloadUrl = new URL(parts[1]);
    } catch {
      throw new Error(`RELEASES line was not rewritten through the download proxy: ${line}`);
    }
    if (!/^\/download\/\d+\/[^/]+$/u.test(downloadUrl.pathname)) {
      throw new Error(`RELEASES line was not rewritten through the download proxy: ${line}`);
    }
    if (!/^\d+$/u.test(parts[2])) {
      throw new Error(`RELEASES line has a non-numeric size: ${line}`);
    }
  }
  if (expectedVersion && !text.includes(expectedVersion)) {
    throw new Error(`win32 RELEASES payload does not reference ${expectedVersion}.`);
  }
  return {
    versionEvidence: expectedVersion ?? 'not-required',
    assetEvidence: `${lines.length} RELEASES line(s)`,
  };
}

/**
 * Probe one platform and normalize every outcome into a result row.
 * Platform-specific payload errors are captured in the row instead of thrown so
 * the final report can show darwin and win32 evidence side by side.
 */
async function validatePlatform({ baseUrl, oldVersion, expectedVersion, platform, fetchImpl }) {
  const url = resolveFeedUrl(baseUrl, platform, oldVersion);
  const response = await fetchImpl(url, { method: 'GET' });
  const contentType = response.headers.get('content-type') ?? '';
  const result = {
    platform,
    url,
    status: response.status,
    ok: false,
    contentType,
    versionEvidence: null,
    assetEvidence: null,
    error: null,
  };

  try {
    if (response.status === 204) {
      if (expectedVersion) {
        throw new Error(`Expected ${expectedVersion}, but the feed returned 204.`);
      }
      result.ok = true;
      result.versionEvidence = 'no-update';
      result.assetEvidence = 'no-update';
      return result;
    }

    if (response.status !== 200) {
      throw new Error(`Unexpected HTTP status ${response.status}.`);
    }

    if (platform === 'darwin') {
      const payload = await response.json();
      const evidence = validateDarwinPayload(payload, expectedVersion);
      result.versionEvidence = evidence.versionEvidence;
      result.assetEvidence = evidence.assetEvidence;
    } else {
      const text = await response.text();
      const evidence = validateWin32Payload(text, expectedVersion);
      result.versionEvidence = evidence.versionEvidence;
      result.assetEvidence = evidence.assetEvidence;
    }
    result.ok = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

export function renderMarkdownReport(report) {
  const lines = [
    '# Desktop update feed validation',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Platform | Status | Result | Version evidence | Asset evidence |',
    '|---|---:|---|---|---|',
  ];
  for (const result of report.results) {
    lines.push(
      `| ${result.platform} | ${result.status} | ${result.ok ? 'pass' : 'fail'} | ${result.versionEvidence ?? result.error ?? ''} | ${result.assetEvidence ?? ''} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Release-gate entry point used by `pnpm run check:update-feed`.
 *
 * It probes selected platforms, writes JSON and Markdown evidence under
 * `output/update-feed-validation/`, and returns `ok: false` for feed shape
 * failures. Argument validation still throws before any network call.
 */
export async function validateUpdateFeed({
  baseUrl = DEFAULT_BASE_URL,
  oldVersion,
  expectedVersion = null,
  platforms = DEFAULT_PLATFORMS,
  outputDir = DEFAULT_OUTPUT_DIR,
  fetchImpl = globalThis.fetch,
  writeArtifacts = true,
} = {}) {
  const normalizedOldVersion = normalizeVersion(oldVersion);
  if (!normalizedOldVersion) {
    throw new Error('--old-version must be a stable semver value like 0.2.4.');
  }
  const normalizedExpectedVersion = expectedVersion ? normalizeVersion(expectedVersion) : null;
  if (expectedVersion && !normalizedExpectedVersion) {
    throw new Error('--expected-version must be a stable semver value like 0.2.5.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node runtime.');
  }

  const resolvedPlatforms = parsePlatforms(platforms);
  const results = [];
  for (const platform of resolvedPlatforms) {
    results.push(
      await validatePlatform({
        baseUrl,
        oldVersion: normalizedOldVersion,
        expectedVersion: normalizedExpectedVersion,
        platform,
        fetchImpl,
      })
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    oldVersion: normalizedOldVersion,
    expectedVersion: normalizedExpectedVersion,
    results,
    ok: results.every(result => result.ok),
  };

  if (writeArtifacts) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, 'update-feed-validation.json'),
      `${JSON.stringify(report, null, 2)}\n`
    );
    await writeFile(
      path.join(outputDir, 'update-feed-validation.md'),
      renderMarkdownReport(report)
    );
  }

  return report;
}

function printHelp() {
  console.log(`Usage: pnpm run check:update-feed -- --old-version <x.y.z> [options]

Options:
  --base-url <url>           Update server base URL. Default: ${DEFAULT_BASE_URL}
  --old-version <x.y.z>      Installed app version used in the update probe. Required.
  --expected-version <x.y.z> Require the feed to serve this newer version.
  --platform <darwin|win32>  Platform to check. Repeatable. Default: darwin + win32.
  --output-dir <path>        Evidence directory. Default: output/update-feed-validation.
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      'base-url': { type: 'string' },
      'old-version': { type: 'string' },
      'expected-version': { type: 'string' },
      platform: { type: 'string', multiple: true },
      'output-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const report = await validateUpdateFeed({
    baseUrl: values['base-url'] ?? DEFAULT_BASE_URL,
    oldVersion: values['old-version'],
    expectedVersion: values['expected-version'] ?? null,
    platforms: values.platform ?? DEFAULT_PLATFORMS,
    outputDir: values['output-dir'] ? path.resolve(values['output-dir']) : DEFAULT_OUTPUT_DIR,
  });

  console.log(renderMarkdownReport(report));
  if (!report.ok) {
    throw new Error('update feed validation failed.');
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
