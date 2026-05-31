#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const playwrightBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
);

// ----------------------------------------------------------------------------
// Build + keypair caching to make iterative e2e runs fast.
//
// Playwright's webServer used to run `vite build && vite preview` inline,
// which meant every test run paid the build cost. We now build here (or
// skip when dist/ is fresh) and the Playwright config only spins up
// `vite preview` against the already-built artifacts.
//
// CRITICAL: the license token's public key is BAKED INTO the bundle at
// build time via `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK`. If we skip the
// build but mint a fresh keypair, the new token will not validate
// against the old public key embedded in the bundle, and every Pro-tier
// test will fail with `expectTier(page, 'PRO')` returning 'FREE'. So we
// cache the minted keypair + token alongside dist/web and ONLY mint a
// new one when the bundle is being rebuilt.
// ----------------------------------------------------------------------------

const passthroughArgs = [];
let skipBuild = false;
let buildIfStale = true;
for (const arg of process.argv.slice(2)) {
  if (arg === '--no-rebuild') {
    skipBuild = true;
    continue;
  }
  if (arg === '--force-rebuild') {
    buildIfStale = false;
    continue;
  }
  passthroughArgs.push(arg);
}

const distDir = path.join(repoRoot, 'dist', 'web');
const cacheDir = path.join(repoRoot, '.cache', 'playwright-e2e');
const licenseCachePath = path.join(cacheDir, 'dev-license.json');
const buildMetadataPath = path.join(cacheDir, 'web-build-metadata.json');
const distIndexPath = path.join(distDir, 'index.html');
const e2eBuildMetadata = {
  cacheVersion: 2,
  e2eHooks: true,
  telemetryUrl: 'https://updates.linguacode.dev/telemetry',
};

function newestMtimeMs(anchorPath) {
  if (!existsSync(anchorPath)) return 0;
  const info = statSync(anchorPath);
  if (!info.isDirectory()) return info.mtimeMs;

  let newest = info.mtimeMs;
  for (const entry of readdirSync(anchorPath, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    newest = Math.max(newest, newestMtimeMs(path.join(anchorPath, entry.name)));
  }
  return newest;
}

const distIsFresh = (() => {
  if (!existsSync(path.join(distDir, 'index.html'))) return false;
  try {
    const distMtime = statSync(path.join(distDir, 'index.html')).mtimeMs;
    // Treat dist as fresh if every web-runtime source was modified
    // before it. The old handful-of-files heuristic skipped rebuilds
    // after component/store edits when locales did not also change,
    // so Playwright could validate stale artifacts.
    const anchors = [
      path.join(repoRoot, 'index.html'),
      path.join(repoRoot, 'src', 'renderer'),
      path.join(repoRoot, 'src', 'shared'),
      path.join(repoRoot, 'src', 'web'),
      path.join(repoRoot, 'vite.web.config.mts'),
    ];
    const newestAnchor = Math.max(...anchors.map(newestMtimeMs));
    return distMtime >= newestAnchor;
  } catch {
    return false;
  }
})();

let needsRebuild;
function cachedLicenseMatchesBundle() {
  if (!existsSync(licenseCachePath) || !existsSync(distIndexPath)) return false;
  if (!existsSync(buildMetadataPath)) return false;
  try {
    // The public key is baked into dist/web during the build. If someone
    // runs `pnpm run build:web` after this script, dist/web can be newer
    // than the cached keypair and every primed-Pro e2e case will stay FREE.
    const metadata = JSON.parse(readFileSync(buildMetadataPath, 'utf8'));
    return (
      statSync(licenseCachePath).mtimeMs >= statSync(distIndexPath).mtimeMs &&
      statSync(buildMetadataPath).mtimeMs >= statSync(distIndexPath).mtimeMs &&
      JSON.stringify(metadata) === JSON.stringify(e2eBuildMetadata)
    );
  } catch {
    return false;
  }
}

if (skipBuild) {
  if (!existsSync(distIndexPath)) {
    console.error(
      '[run-playwright-web-validation] --no-rebuild was passed but dist/web/index.html does not exist. Drop the flag for one invocation.'
    );
    process.exit(2);
  }
  console.log('[run-playwright-web-validation] --no-rebuild: reusing dist/web');
  needsRebuild = false;
} else if (buildIfStale && distIsFresh && cachedLicenseMatchesBundle()) {
  console.log(
    '[run-playwright-web-validation] dist/web is fresh; skipping build. Use --force-rebuild to override.'
  );
  needsRebuild = false;
} else {
  needsRebuild = true;
}

// Mint a fresh keypair ONLY when we rebuild — the public key bakes into
// the bundle, so a fresh keypair on a stale bundle would invalidate every
// signed token and break every Pro-tier test.
let mintedLicense;
if (needsRebuild) {
  console.log(
    '[run-playwright-web-validation] minting fresh keypair for the upcoming build…'
  );
  mintedLicense = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts', 'mint-dev-license.mjs'),
        '--tier',
        'pro',
        '--days',
        '7',
        '--issued-to',
        'playwright@local',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    )
  );
  console.log('[run-playwright-web-validation] building dist/web…');
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--config',
      'vite.web.config.mts',
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: mintedLicense.publicKeyJwk,
        VITE_LINGUA_TELEMETRY_URL: e2eBuildMetadata.telemetryUrl,
        LINGUA_E2E_HOOKS: '1',
      },
    }
  );
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(licenseCachePath, JSON.stringify(mintedLicense, null, 2));
  writeFileSync(buildMetadataPath, JSON.stringify(e2eBuildMetadata, null, 2));
} else {
  console.log(
    '[run-playwright-web-validation] reusing cached keypair + bundle (token validates against baked-in public key).'
  );
  mintedLicense = JSON.parse(readFileSync(licenseCachePath, 'utf8'));
}

const child = spawn(
  playwrightBin,
  ['test', '-c', 'playwright.license-web.config.mts', ...passthroughArgs],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      LINGUA_DEV_LICENSE_PUBLIC_KEY_JWK: mintedLicense.publicKeyJwk,
      LINGUA_DEV_LICENSE_TOKEN: mintedLicense.token,
    },
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
