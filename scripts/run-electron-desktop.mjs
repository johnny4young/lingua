#!/usr/bin/env node
/* global URL, clearTimeout, console, fetch, setTimeout */

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const esbuildBin = path.join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild');
const builtMainPath = path.join(repoRoot, '.vite', 'build', 'main.js');
const builtPreloadPath = path.join(repoRoot, '.vite', 'build', 'preload.js');
const rendererConfigPath = path.join(repoRoot, 'vite.renderer.config.mts');
const defaultRendererUrl = 'http://localhost:5174';
const serverReadyTimeoutMs = 30_000;
const shutdownTimeoutMs = 5_000;

function parseArgs(argv) {
  const options = {
    rendererUrl: process.env.LINGUA_RENDERER_URL ?? null,
    syncMain: false,
    reuseServer: false,
    exitAfterMs: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--sync-main') {
      options.syncMain = true;
      continue;
    }

    if (arg === '--reuse-server') {
      options.reuseServer = true;
      continue;
    }

    if (arg.startsWith('--renderer-url=')) {
      options.rendererUrl = arg.slice('--renderer-url='.length);
      continue;
    }

    if (arg === '--renderer-url') {
      options.rendererUrl = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--exit-after-ms=')) {
      options.exitAfterMs = Number.parseInt(arg.slice('--exit-after-ms='.length), 10);
      continue;
    }

    if (arg === '--exit-after-ms') {
      options.exitAfterMs = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function extractRendererUrlFromBuiltMain(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }

  const source = await readFile(filePath, 'utf8');
  const match = source.match(/mainWindow\.loadURL\((["'`])([^"'`]+)\1\)/);
  return match?.[2] ?? null;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 404) {
        return;
      }

      lastError = new Error(`Unexpected response ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  const detail =
    lastError instanceof Error ? lastError.message : 'renderer dev server did not become ready';
  throw new Error(`Timed out waiting for ${url}: ${detail}`);
}

function spawnManagedProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: repoRoot,
    stdio: options.stdio ?? 'inherit',
    env: {
      ...process.env,
      ...options.env,
    },
    detached: process.platform !== 'win32',
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function terminateChild(label, child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const { graceful = false } = options;

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
      killer.once('exit', () => resolve());
    });
    return;
  }

  try {
    if (graceful) {
      child.kill('SIGTERM');
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }

  const exitResult = await Promise.race([
    waitForExit(child),
    new Promise((resolve) => {
      setTimeout(() => resolve(null), shutdownTimeoutMs);
    }),
  ]);

  if (exitResult !== null) {
    return;
  }

  console.warn(`[desktop] ${label} did not exit after SIGTERM; forcing shutdown`);

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Process already exited.
    }
  }
}

async function runEsbuild(args) {
  const buildProcess = spawnManagedProcess(process.execPath, [esbuildBin, ...args]);

  const result = await waitForExit(buildProcess);
  if (result.code !== 0) {
    throw new Error('Standalone Electron bundle build failed');
  }
}

async function ensureMainArtifacts(rendererUrl, syncMain) {
  const mainExists = await fileExists(builtMainPath);
  const preloadExists = await fileExists(builtPreloadPath);
  const needsBootstrap = !mainExists || !preloadExists;

  if (!needsBootstrap && !syncMain) {
    return;
  }

  const modeLabel = needsBootstrap ? 'Bootstrapping' : 'Syncing';
  console.log(`[desktop] ${modeLabel} Electron main/preload bundles`);

  await runEsbuild([
    path.join(repoRoot, 'src', 'main', 'index.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--sourcemap',
    '--outfile=.vite/build/main.js',
    '--external:electron',
    '--external:electron-squirrel-startup',
    '--define:MAIN_WINDOW_VITE_DEV_SERVER_URL=' + JSON.stringify(rendererUrl),
    '--define:MAIN_WINDOW_VITE_NAME=' + JSON.stringify('main_window'),
    '--define:__LINGUA_UPDATE_URL__=' + JSON.stringify(process.env.LINGUA_UPDATE_URL ?? 'https://lingua-update-server.johnny4young.workers.dev'),
  ]);

  await runEsbuild([
    path.join(repoRoot, 'src', 'preload', 'index.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--sourcemap',
    '--outfile=.vite/build/preload.js',
    '--external:electron',
  ]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const builtRendererUrl =
    options.rendererUrl ?? (await extractRendererUrlFromBuiltMain(builtMainPath));
  const rendererUrl = builtRendererUrl ?? defaultRendererUrl;
  const parsedRendererUrl = new URL(rendererUrl);

  await ensureMainArtifacts(parsedRendererUrl.toString(), options.syncMain);

  let serverProcess = null;
  let serverOwned = false;
  let electronProcess = null;
  let shuttingDown = false;
  let exitAfterTimer = null;

  const cleanup = async (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    if (exitAfterTimer !== null) {
      clearTimeout(exitAfterTimer);
    }

    await Promise.all([
      terminateChild('electron', electronProcess, { graceful: true }),
      serverOwned
        ? terminateChild('renderer dev server', serverProcess, { graceful: true })
        : Promise.resolve(),
    ]);

    process.exit(exitCode);
  };

  const handleFatalError = async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[desktop] ${message}`);
    await cleanup(1);
  };

  process.on('SIGINT', () => {
    void cleanup(130);
  });
  process.on('SIGTERM', () => {
    void cleanup(143);
  });
  process.on('uncaughtException', (error) => {
    void handleFatalError(error);
  });
  process.on('unhandledRejection', (error) => {
    void handleFatalError(error);
  });

  try {
    if (options.reuseServer) {
      console.log(`[desktop] Reusing renderer server at ${parsedRendererUrl.toString()}`);
      await waitForServer(parsedRendererUrl.toString(), serverReadyTimeoutMs);
    } else {
      serverProcess = spawnManagedProcess(process.execPath, [
        viteBin,
        'serve',
        '--config',
        rendererConfigPath,
        '--host',
        parsedRendererUrl.hostname,
        '--port',
        parsedRendererUrl.port || '80',
        '--strictPort',
      ]);
      serverOwned = true;

      serverProcess.once('exit', (code) => {
        if (!shuttingDown) {
          console.error(
            `[desktop] Renderer dev server exited unexpectedly with code ${code ?? 'unknown'}`
          );
          void cleanup(code ?? 1);
        }
      });

      await waitForServer(parsedRendererUrl.toString(), serverReadyTimeoutMs);
    }

    console.log(`[desktop] Launching Electron against ${parsedRendererUrl.toString()}`);
    electronProcess = spawnManagedProcess(electronBinary, ['.'], {
      env: {
        LINGUA_RENDERER_URL: parsedRendererUrl.toString(),
      },
      stdio: 'inherit',
    });

    electronProcess.once('exit', (code, signal) => {
      if (!shuttingDown) {
        const normalizedExitCode =
          typeof code === 'number' ? code : signal ? 0 : 1;
        void cleanup(normalizedExitCode);
      }
    });

    if (typeof options.exitAfterMs === 'number' && Number.isFinite(options.exitAfterMs)) {
      exitAfterTimer = setTimeout(() => {
        console.log(
          `[desktop] exit-after-ms reached (${options.exitAfterMs}ms); closing Electron`
        );
        void terminateChild('electron', electronProcess, { graceful: true });
      }, options.exitAfterMs);
    }
  } catch (error) {
    await handleFatalError(error);
  }
}

await main();
