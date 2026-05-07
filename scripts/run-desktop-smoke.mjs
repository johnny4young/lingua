#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const artifactDir = path.join(repoRoot, 'output', 'playwright', 'desktop-smoke');
const progressPath = path.join(artifactDir, 'desktop-smoke-progress.json');
const summaryPath = path.join(artifactDir, 'desktop-smoke-summary.json');
const maxSmokeRuntimeMs = 180_000;

const AGAINST_PACKAGED_FLAG = '--against-packaged';

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseAgainstPackaged(argv) {
  const idx = argv.findIndex((arg) => arg === AGAINST_PACKAGED_FLAG || arg.startsWith(`${AGAINST_PACKAGED_FLAG}=`));
  if (idx === -1) return null;
  const arg = argv[idx];
  if (arg.includes('=')) {
    const value = arg.slice(arg.indexOf('=') + 1);
    if (!value) {
      throw new Error(`${AGAINST_PACKAGED_FLAG} requires a path`);
    }
    return value;
  }
  const value = argv[idx + 1] ?? null;
  if (!value || value.startsWith('--')) {
    throw new Error(`${AGAINST_PACKAGED_FLAG} requires a path`);
  }
  return value;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// BFS bound: depth cap + skip list. The default invocation
// (`out/make`) is shallow and clean, but a developer who points
// `--against-packaged` at the repo root would otherwise walk
// `node_modules` / `.git` / `.vite` for tens of thousands of dirs.
const BFS_MAX_DEPTH = 8;
const BFS_SKIP_DIRS = new Set(['node_modules', '.git', '.vite', 'output']);

async function bfsFor(dir, predicate) {
  const queue = [{ path: dir, depth: 0 }];
  while (queue.length > 0) {
    const { path: current, depth } = queue.shift();
    if (depth > BFS_MAX_DEPTH) continue;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (BFS_SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      const match = predicate(entry, full);
      if (match) return full;
      if (entry.isDirectory() && !entry.name.endsWith('.app')) {
        queue.push({ path: full, depth: depth + 1 });
      }
    }
  }
  return null;
}

async function findFirstDarwinZip(dir) {
  return bfsFor(
    dir,
    (entry) => entry.isFile() && /^lingua-darwin-.*\.zip$/iu.test(entry.name),
  );
}

async function findFirstApp(dir) {
  // Prefer the top-level `Lingua.app` over any sibling helper bundle
  // (e.g. `ShipIt.app`, `Electron Helper.app`). BFS already avoids
  // descending into a `.app` directory, so this only matters when
  // multiple `.app` bundles sit at the same depth — which can happen
  // depending on how Forge lays out `out/make` between versions.
  const preferred = await bfsFor(
    dir,
    (entry) => entry.isDirectory() && entry.name === 'Lingua.app',
  );
  if (preferred) return preferred;
  return bfsFor(
    dir,
    (entry) => entry.isDirectory() && entry.name.endsWith('.app'),
  );
}

async function resolvePackagedApp(input) {
  // Caller can pass:
  //   - a `.app` directory directly
  //   - a `.zip` file containing the `.app`
  //   - a directory (e.g. `out/make`) we walk to find a darwin zip
  //     or an extracted `.app`
  const stats = await stat(input);
  if (stats.isDirectory() && input.endsWith('.app')) {
    return input;
  }
  if (stats.isFile() && input.endsWith('.zip')) {
    return await extractZipAndFindApp(input);
  }
  if (stats.isDirectory()) {
    const existingApp = await findFirstApp(input);
    if (existingApp) return existingApp;
    const zip = await findFirstDarwinZip(input);
    if (zip) return await extractZipAndFindApp(zip);
  }
  throw new Error(`Could not find a Lingua.app under ${input}`);
}

async function extractZipAndFindApp(zipPath) {
  const tempRoot = process.env.RUNNER_TEMP ?? os.tmpdir();
  const extractDir = path.join(tempRoot, 'lingua-packaged-smoke');
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });

  // `ditto -xk --rsrc` is the macOS-native unzipper that preserves
  // codesign metadata and resource forks. `unzip` would mangle the
  // codesign and Gatekeeper would reject the launch.
  const result = spawnSync('ditto', ['-xk', '--rsrc', zipPath, extractDir], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${zipPath} (ditto exit ${result.status})`);
  }

  const app = await findFirstApp(extractDir);
  if (!app) {
    throw new Error(`No .app bundle found inside ${zipPath} after extraction`);
  }
  return app;
}

function clearQuarantine(appPath) {
  // CI runners pull the artifact via download-artifact + ditto extract,
  // which preserves the com.apple.quarantine attribute. Remove ONLY
  // that attribute so Gatekeeper does not block the launch in a
  // non-interactive runner. `xattr -cr` would also strip
  // `com.apple.cs.*` notarization-related xattrs and force Gatekeeper
  // to re-verify online on every launch — turning a transient Apple
  // service outage into a smoke failure. The staple ticket itself
  // lives inside the bundle (not as an xattr), so this targeted
  // delete preserves it. Use `|| true` because the attribute may not
  // exist on every file (xattr -d errors when the attr is absent).
  const result = spawnSync(
    'bash',
    ['-c', `xattr -dr com.apple.quarantine "$1" 2>/dev/null || true`, '--', appPath],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.warn(
      `[desktop-smoke] xattr -dr com.apple.quarantine exited ${result.status} on ${appPath} — continuing`,
    );
  }
}

async function main() {
  // Cross-platform offline-mode flag. The previous shape
  // (`LINGUA_DESKTOP_SMOKE_OFFLINE=1 node ...` in package.json) only
  // worked on POSIX shells — on Windows the var was never set and the
  // offline gate silently no-op'd. Read either the flag or the env
  // var so existing CI invocations keep working.
  const offlineMode =
    process.argv.includes('--offline') ||
    process.env.LINGUA_DESKTOP_SMOKE_OFFLINE === '1';
  if (offlineMode) {
    console.log('[desktop-smoke] offline mode: blocking non-loopback HTTP/HTTPS requests');
  }

  // RL-080 Slice 3 — packaged-mode flag. When set, skip the Vite dev
  // server + run-electron-desktop launcher entirely and run the smoke
  // directly against the produced `Lingua.app`. macOS-only for now.
  // Forces the renderer hook into the 2-runtime-case subset
  // (javascript + python) via LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET=1.
  let packagedInput;
  try {
    packagedInput = parseAgainstPackaged(process.argv);
  } catch (error) {
    console.error(`[desktop-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (packagedInput && process.platform !== 'darwin') {
    console.error('[desktop-smoke] --against-packaged is macOS-only at this slice.');
    process.exit(1);
  }

  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });

  let child;
  let resolvedAppPath = null;

  if (packagedInput) {
    if (!(await exists(packagedInput))) {
      console.error(`[desktop-smoke] --against-packaged path does not exist: ${packagedInput}`);
      process.exit(1);
    }
    resolvedAppPath = await resolvePackagedApp(packagedInput);
    clearQuarantine(resolvedAppPath);
    const binary = path.join(resolvedAppPath, 'Contents', 'MacOS', 'Lingua');
    if (!(await exists(binary))) {
      console.error(`[desktop-smoke] expected packaged binary missing: ${binary}`);
      process.exit(1);
    }
    console.log(`[desktop-smoke] packaged mode: launching ${binary}`);
    const launchedAtMs = Date.now();
    child = spawn(
      binary,
      [
        '--lingua-desktop-smoke',
        `--lingua-smoke-artifact-dir=${artifactDir}`,
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          LINGUA_DESKTOP_SMOKE: '1',
          LINGUA_SMOKE_ARTIFACT_DIR: artifactDir,
          LINGUA_SMOKE_LAUNCHED_AT_MS: String(launchedAtMs),
          LINGUA_SMOKE_SECRET: '__lingua_smoke_secret__',
          LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET: '1',
          ...(offlineMode ? { LINGUA_DESKTOP_SMOKE_OFFLINE: '1' } : {}),
        },
      },
    );
  } else {
    const launchedAtMs = Date.now();
    child = spawn(
      process.execPath,
      [
        path.join(repoRoot, 'scripts', 'run-electron-desktop.mjs'),
        '--sync-main',
        '--',
        '--lingua-desktop-smoke',
        `--lingua-smoke-artifact-dir=${artifactDir}`,
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          LINGUA_ELECTRON_LAUNCHER:
            process.platform === 'darwin'
              ? process.env.LINGUA_ELECTRON_LAUNCHER ?? 'open'
              : process.env.LINGUA_ELECTRON_LAUNCHER,
          LINGUA_DESKTOP_SMOKE: '1',
          LINGUA_SMOKE_ARTIFACT_DIR: artifactDir,
          LINGUA_SMOKE_LAUNCHED_AT_MS: String(launchedAtMs),
          // RL-079 — sentinel secret seeded into Electron's process.env.
          // The go-env-isolation / rust-env-isolation smoke cases run a
          // user-toolchain subprocess that prints the value of this
          // variable; the smoke harness fails if the captured stdout
          // contains the secret, which would mean the env builder
          // leaked it. Real CI environments do not set this name.
          LINGUA_SMOKE_SECRET: '__lingua_smoke_secret__',
          // RL-083 Slice 1 — propagate offline mode to the spawned
          // Electron so its main process installs the webRequest
          // filter before any window loads.
          ...(offlineMode ? { LINGUA_DESKTOP_SMOKE_OFFLINE: '1' } : {}),
        },
      },
    );
  }

  const timeoutId = setTimeout(() => {
    console.error(
      `[desktop-smoke] Timed out after ${maxSmokeRuntimeMs}ms; terminating Electron smoke run`
    );
    terminateChild(child);
  }, maxSmokeRuntimeMs);

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  clearTimeout(timeoutId);

  try {
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    const failedCases = summary.cases.filter((item) => !item.ok);

    console.log(`[desktop-smoke] Artifacts: ${artifactDir}`);
    console.log(`[desktop-smoke] Cases: ${summary.cases.length}, failures: ${failedCases.length}`);

    if (failedCases.length > 0) {
      for (const failedCase of failedCases) {
        console.error(
          `[desktop-smoke] ${failedCase.language} failed: ${failedCase.message}`
        );
      }
    }
  } catch (error) {
    const progress = await readJsonIfPresent(progressPath);
    console.error(
      `[desktop-smoke] Failed to read smoke summary at ${summaryPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (progress) {
      console.error(`[desktop-smoke] Last known progress: ${JSON.stringify(progress)}`);
    }
    process.exit(1);
  }

  process.exit(exitCode);
}

await main();
