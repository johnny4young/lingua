#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { resolveE2ePreviewServer } from './lib/e2ePreviewServer.mjs';
import { RUNTIME_ASSETS } from '../src/shared/runtimeAssets.ts';

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
let playwrightConfig = 'playwright.license-web.config.mts';
for (const arg of process.argv.slice(2)) {
  if (arg === '--visual') {
    playwrightConfig = 'playwright.visual.config.mts';
    continue;
  }
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
const buildInputsFingerprint = skipBuild ? null : fingerprintBuildInputs();
const e2eBuildMetadata = {
  cacheVersion: 4,
  buildInputsFingerprint,
  e2eHooks: true,
  telemetryUrl: 'https://updates.linguacode.dev/telemetry',
  // Local e2e builds keep DuckDB/Ruby WASM same-origin (see the
  // LINGUA_WEB_RUNTIME_SAME_ORIGIN note in vite.web.config.mts): the
  // R2 mirror only serves CORS headers to the production app origin,
  // so a localhost preview fetching it trips the zero-console-error
  // fixture. Tracked in the metadata so a dist built before this flag
  // existed (or with it unset) cannot be reused by a cached run.
  sameOriginRuntime: true,
};

// Only resolution conditions change the bundle; heap sizes and debugger
// preloads in NODE_OPTIONS would otherwise force needless rebuilds.
function nodeConditions(options = '') {
  const tokens = options.split(/\s+/).filter(Boolean);
  const kept = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (/^(--conditions|-C)=/.test(tokens[index])) kept.push(tokens[index]);
    else if (tokens[index] === '--conditions' || tokens[index] === '-C') kept.push(`--conditions=${tokens[++index] ?? ''}`);
  }
  return kept.join(' ');
}

// Dotfiles (Finder metadata, vim swap, Emacs locks) and editor backups are never build inputs.
function isEditorArtifact(name) {
  return name.startsWith('.') || name.endsWith('~') || name.includes('___jb_');
}

/** Metadata freshness only: never read dotenv contents or persist env values. */
function fingerprintBuildInputs() {
  try {
    const hash = createHash('sha256');
    // These two caller values are replaced by the minted key and fixed E2E
    // endpoint below. Other VITE_* values can be embedded by Vite.
    const overridden = new Set(['VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK', 'VITE_LINGUA_TELEMETRY_URL']);
    const buildEnv = Object.keys(process.env)
      .filter(name => (name.startsWith('VITE_') && !overridden.has(name)) ||
        name.startsWith('BROWSERSLIST') || name === 'LINGUA_WEBSITE_URL' || name === 'NODE_OPTIONS')
      .sort()
      .map(name => [name, name === 'NODE_OPTIONS' ? nodeConditions(process.env[name]) : process.env[name]])
      .filter(([name, value]) => name.startsWith('VITE_') || Boolean(value));
    hash.update(JSON.stringify([process.version, process.platform, process.arch, process.env.NODE_ENV || 'production', buildEnv]));
    const inputs = [
      'src/renderer', 'src/shared', 'src/web', 'build', 'public', 'patches',
      'package.json', 'CHANGELOG.md', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
      'postcss.config.mjs', 'vite.web.config.mts', 'runtime-assets.lock.json',
      '.browserslistrc', 'browserslist',
      '.env', '.env.local', '.env.production', '.env.production.local',
      'node_modules/.modules.yaml', 'node_modules/.package-lock.json',
      ...Object.values(RUNTIME_ASSETS).flatMap(asset =>
        (asset.copyFiles ?? asset.criticalFiles).map(file => path.join(asset.nodeModulesPath, file))),
    ];

    for (const name of ['BROWSERSLIST_CONFIG', 'BROWSERSLIST_STATS', 'BROWSERSLIST_ROOT_PATH']) {
      if (!process.env[name]) continue;
      const absolutePath = path.resolve(repoRoot, process.env[name]);
      const relativePath = path.relative(repoRoot, absolutePath);
      // Do not inspect configuration outside the checkout. Rebuild instead.
      if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return null;
      if (name !== 'BROWSERSLIST_ROOT_PATH') {
        if (!relativePath || (existsSync(absolutePath) && statSync(absolutePath).isDirectory())) return null;
        inputs.push(relativePath);
      }
    }

    function visit(relativePath) {
      const absolutePath = path.join(repoRoot, relativePath);
      let info;
      try {
        info = statSync(absolutePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        hash.update(JSON.stringify([relativePath, null]));
        return;
      }
      if (info.isDirectory()) {
        // Directory timestamps alone change for ignored Finder metadata.
        // Enumerating names still detects removals and renames.
        hash.update(JSON.stringify([relativePath, 'directory']));
        for (const name of readdirSync(absolutePath).sort()) {
          if (!isEditorArtifact(name)) visit(path.join(relativePath, name));
        }
      } else {
        // pnpm hardlinks node_modules from a shared store, so another install changes ctime there.
        const ctime = relativePath.startsWith(`node_modules${path.sep}`) ? 0 : info.ctimeMs;
        hash.update(JSON.stringify([relativePath, info.size, info.mtimeMs, ctime]));
      }
    }
    for (const input of inputs) visit(input);
    return hash.digest('hex');
  } catch {
    // An unreadable input cannot justify reusing an old bundle.
    return null;
  }
}

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
} else if (buildIfStale && buildInputsFingerprint && cachedLicenseMatchesBundle()) {
  console.log(
    '[run-playwright-web-validation] dist/web is fresh; skipping build. Use --force-rebuild to override.'
  );
  needsRebuild = false;
} else {
  if (buildIfStale && !buildInputsFingerprint) {
    console.log(
      '[run-playwright-web-validation] build inputs could not be fingerprinted (unreadable input or external Browserslist config); rebuilding.'
    );
  }
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
        // Hermetic validation build — see e2eBuildMetadata.sameOriginRuntime.
        LINGUA_WEB_RUNTIME_SAME_ORIGIN: '1',
      },
    }
  );
  // The new bundle bakes this key in, so --no-rebuild must find it even when
  // the stale metadata below forces the next cached run to rebuild.
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(licenseCachePath, JSON.stringify(mintedLicense, null, 2));
  if (buildInputsFingerprint && fingerprintBuildInputs() !== buildInputsFingerprint) {
    console.error(
      '[run-playwright-web-validation] Web build inputs changed during compilation; rerun against settled inputs.'
    );
    process.exit(1);
  }
  writeFileSync(buildMetadataPath, JSON.stringify(e2eBuildMetadata, null, 2));
} else {
  console.log(
    '[run-playwright-web-validation] reusing cached keypair + bundle (token validates against baked-in public key).'
  );
  mintedLicense = JSON.parse(readFileSync(licenseCachePath, 'utf8'));
}

// Probed after the build: a preview of this checkout serves dist/web from disk.
let previewServer;
try {
  previewServer = await resolveE2ePreviewServer({
    repoRoot,
    indexHtml: readFileSync(distIndexPath, 'utf8'),
  });
} catch (error) {
  console.error(`[run-playwright-web-validation] ${error.message}`);
  process.exit(2);
}
console.log(
  `[run-playwright-web-validation] preview server: http://localhost:${previewServer.port} (${
    previewServer.reuse ? 'reusing this checkout\'s server' : 'starting a new one'
  })`
);

const child = spawn(
  playwrightBin,
  ['test', '-c', playwrightConfig, ...passthroughArgs],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      LINGUA_DEV_LICENSE_PUBLIC_KEY_JWK: mintedLicense.publicKeyJwk,
      LINGUA_DEV_LICENSE_TOKEN: mintedLicense.token,
      LINGUA_E2E_PORT: String(previewServer.port),
      LINGUA_E2E_REUSE_SERVER: previewServer.reuse ? '1' : '0',
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
