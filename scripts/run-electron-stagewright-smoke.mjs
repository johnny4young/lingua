#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const esbuildBin = path.join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild');
const rendererConfigPath = path.join(repoRoot, 'vite.renderer.config.mts');
const builtMainPath = path.join(repoRoot, '.vite', 'build', 'main.js');
const builtPreloadPath = path.join(repoRoot, '.vite', 'build', 'preload.js');
const artifactDir = path.join(repoRoot, 'output', 'stagewright', 'desktop-smoke');
const defaultRendererUrl = 'http://localhost:5174';
// Default to the sibling-repo layout (../electron-stagewright) so the script is
// portable instead of baking in one machine's home path. Override with
// ELECTRON_STAGEWRIGHT_CLI or --stagewright-cli when the checkout lives elsewhere.
const defaultStagewrightCli = path.resolve(
  repoRoot,
  '..',
  'electron-stagewright',
  'packages',
  'core',
  'dist',
  'cli.js'
);
const serverReadyTimeoutMs = 30_000;
const shutdownTimeoutMs = 5_000;

function parseArgs(argv) {
  const options = {
    rendererUrl: process.env.LINGUA_RENDERER_URL ?? defaultRendererUrl,
    reuseServer: false,
    syncMain: true,
    timeoutMs: 60_000,
    stagewrightCli: process.env.ELECTRON_STAGEWRIGHT_CLI ?? defaultStagewrightCli,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--reuse-server') {
      options.reuseServer = true;
      continue;
    }

    if (arg === '--no-sync-main') {
      options.syncMain = false;
      continue;
    }

    if (arg.startsWith('--renderer-url=')) {
      options.rendererUrl = arg.slice('--renderer-url='.length);
      continue;
    }

    if (arg === '--renderer-url') {
      options.rendererUrl = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10);
      continue;
    }

    if (arg === '--timeout-ms') {
      options.timeoutMs = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    if (arg.startsWith('--stagewright-cli=')) {
      options.stagewrightCli = arg.slice('--stagewright-cli='.length);
      continue;
    }

    if (arg === '--stagewright-cli') {
      options.stagewrightCli = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.rendererUrl) {
    throw new Error('--renderer-url requires a value');
  }
  if (!options.stagewrightCli) {
    throw new Error('--stagewright-cli requires a value');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }

  return options;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function spawnManagedProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
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

async function terminateChild(label, child) {
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
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }

  const result = await Promise.race([
    waitForExit(child),
    new Promise((resolve) => {
      setTimeout(() => resolve(null), shutdownTimeoutMs);
    }),
  ]);

  if (result !== null) {
    return;
  }

  console.warn(`[stagewright-smoke] ${label} did not exit after SIGTERM; forcing shutdown`);

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
  const buildProcess = spawnManagedProcess(esbuildBin, args);
  const result = await waitForExit(buildProcess);
  if (result.code !== 0) {
    throw new Error('Standalone Electron bundle build failed');
  }
}

async function ensureMainArtifacts(rendererUrl, syncMain) {
  if (!syncMain && (await exists(builtMainPath)) && (await exists(builtPreloadPath))) {
    return;
  }

  console.log('[stagewright-smoke] Syncing Electron main/preload bundles');

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
    '--define:__LINGUA_UPDATE_URL__=' +
      JSON.stringify(
        process.env.LINGUA_UPDATE_URL ?? 'https://lingua-update-server.johnny4young.workers.dev'
      ),
    '--define:__LINGUA_LICENSE_PUBLIC_KEY_JWK__=' +
      JSON.stringify(
        process.env.LINGUA_LICENSE_PUBLIC_KEY_JWK ??
          process.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK ??
          ''
      ),
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

class McpClient {
  constructor(command, args, options = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.stderrTail = [];
    this.child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...options.env,
      },
      detached: process.platform !== 'win32',
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.handleStdout(chunk);
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        this.stderrTail.push(line);
        if (this.stderrTail.length > 20) this.stderrTail.shift();
        process.stderr.write(`[electron-stagewright] ${line}\n`);
      }
    });

    this.child.once('exit', (code, signal) => {
      const error = new Error(
        `electron-stagewright MCP server exited with ${code ?? signal ?? 'unknown'}`
      );
      for (const { reject } of this.pending.values()) {
        reject(error);
      }
      this.pending.clear();
    });
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        console.error(`[stagewright-smoke] Ignoring non-JSON MCP frame: ${line}`);
        continue;
      }

      if (message.id === undefined) {
        continue;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        continue;
      }
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (!this.child.stdin.writable) {
      throw new Error('electron-stagewright MCP stdin is not writable');
    }

    const id = this.nextId;
    this.nextId += 1;

    const payload = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  notify(method, params = {}) {
    if (!this.child.stdin.writable) {
      return;
    }
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'lingua-electron-stagewright-smoke',
        version: '0.0.0',
      },
    });
    this.notify('notifications/initialized');
  }

  async callTool(name, args = {}, timeoutMs = 60_000) {
    const result = await this.request(
      'tools/call',
      {
        name,
        arguments: args,
      },
      timeoutMs
    );
    const first = result?.content?.[0];
    if (!first || first.type !== 'text' || typeof first.text !== 'string') {
      throw new Error(`${name}: expected a text content block from the MCP response`);
    }

    const envelope = JSON.parse(first.text);
    if (!envelope.ok) {
      throw new Error(
        `${name} failed: ${envelope.code ?? 'UNKNOWN'} — ${
          envelope.error ?? envelope.message ?? first.text
        }`
      );
    }
    return envelope;
  }

  async close() {
    if (this.child.stdin.writable) {
      this.child.stdin.end();
    }
    await terminateChild('electron-stagewright MCP server', this.child);
  }
}

async function runStagewrightSmoke(options, rendererUrl) {
  if (!(await exists(options.stagewrightCli))) {
    throw new Error(
      [
        `electron-stagewright CLI was not found at ${options.stagewrightCli}.`,
        'Build it in your electron-stagewright checkout with:',
        '  pnpm --filter @electron-stagewright/core build',
        'then set ELECTRON_STAGEWRIGHT_CLI=/abs/path/to/packages/core/dist/cli.js',
        'or pass --stagewright-cli /abs/path/to/packages/core/dist/cli.js.',
      ].join('\n')
    );
  }

  const client = new McpClient('node', [
    options.stagewrightCli,
    '--screenshot-dir',
    artifactDir,
  ]);
  let sessionId = null;

  try {
    await client.initialize();
    const tools = await client.request('tools/list');
    const toolNames = new Set(tools?.tools?.map((tool) => tool.name) ?? []);
    for (const requiredTool of [
      'electron_launch',
      'electron_snapshot',
      'electron_expect_visible',
      'electron_console_logs',
      'electron_screenshot',
      'electron_stop',
    ]) {
      if (!toolNames.has(requiredTool)) {
        throw new Error(`electron-stagewright server is missing ${requiredTool}`);
      }
    }

    const launched = await client.callTool(
      'electron_launch',
      {
        main: repoRoot,
        cwd: repoRoot,
        env: {
          LINGUA_RENDERER_URL: rendererUrl,
        },
        readyTimeoutMs: 15_000,
      },
      options.timeoutMs
    );
    sessionId = launched.session_id;
    console.log(`[stagewright-smoke] Launched Lingua session ${sessionId}`);

    const info = await client.callTool('electron_info', { sessionId });
    await client.callTool(
      'electron_expect_visible',
      {
        sessionId,
        selector: '#root',
        timeoutMs: 15_000,
      },
      20_000
    );

    const snapshot = await client.callTool('electron_snapshot', {
      sessionId,
      interactiveOnly: true,
      maxEntries: 300,
    });
    const entries = snapshot.snapshot?.entries ?? [];
    if (entries.length === 0) {
      throw new Error('electron_snapshot returned no interactive entries');
    }

    const screenshot = await client.callTool('electron_screenshot', {
      sessionId,
      format: 'png',
      dir: artifactDir,
    });

    const consoleErrors = await client.callTool('electron_console_logs', {
      sessionId,
      type: 'error',
      limit: 100,
    });
    if ((consoleErrors.count ?? 0) > 0) {
      throw new Error(
        `Renderer emitted ${consoleErrors.count} console error(s): ${JSON.stringify(
          consoleErrors.entries
        )}`
      );
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      rendererUrl,
      appEntryPath: repoRoot,
      sessionId,
      app: info.app ?? null,
      versions: info.versions ?? null,
      interactiveEntries: entries.length,
      screenshotPath: screenshot.path,
      consoleErrors: consoleErrors.count ?? 0,
    };
    await writeFile(
      path.join(artifactDir, 'electron-stagewright-summary.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    );

    console.log(`[stagewright-smoke] Snapshot entries: ${entries.length}`);
    console.log(`[stagewright-smoke] Screenshot: ${screenshot.path}`);
    console.log(`[stagewright-smoke] Summary: ${path.join(artifactDir, 'electron-stagewright-summary.json')}`);
  } finally {
    if (sessionId) {
      await client.callTool('electron_stop', { sessionId }, 20_000).catch((error) => {
        console.warn(
          `[stagewright-smoke] electron_stop failed during cleanup: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }
    await client.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rendererUrl = new URL(options.rendererUrl).toString();

  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });
  await ensureMainArtifacts(rendererUrl, options.syncMain);

  let serverProcess = null;
  let serverOwned = false;
  let stoppingServer = false;

  try {
    if (options.reuseServer) {
      console.log(`[stagewright-smoke] Reusing renderer server at ${rendererUrl}`);
      await waitForServer(rendererUrl, serverReadyTimeoutMs);
    } else {
      const parsedRendererUrl = new URL(rendererUrl);
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
        if (!stoppingServer && code !== null && code !== 0) {
          console.error(`[stagewright-smoke] Renderer dev server exited with ${code}`);
        }
      });
      await waitForServer(rendererUrl, serverReadyTimeoutMs);
    }

    await runStagewrightSmoke(options, rendererUrl);
  } finally {
    if (serverOwned) {
      stoppingServer = true;
      await terminateChild('renderer dev server', serverProcess);
    }
  }
}

main().catch((error) => {
  console.error(`[stagewright-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
