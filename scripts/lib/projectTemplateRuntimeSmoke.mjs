import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

export const PROJECT_TEMPLATE_SMOKE_IDS = Object.freeze([
  'express-api-hello',
  'fastapi-hello',
  'node-cli-argparse',
  'react-component-sandbox',
  'python-data-explorer',
]);

const COMMAND_TIMEOUT_MS = 5 * 60_000;
const SERVER_TIMEOUT_MS = 30_000;
const LOG_LIMIT = 12_000;

function commandName(base) {
  return process.platform === 'win32' ? `${base}.cmd` : base;
}

function trimLog(value) {
  if (value.length <= LOG_LIMIT) return value;
  return `[...${value.length - LOG_LIMIT} characters omitted...]\n${value.slice(-LOG_LIMIT)}`;
}

function quoteArgument(argument) {
  return /[\s"']/u.test(argument) ? JSON.stringify(argument) : argument;
}

function formatCommand(command, args) {
  return [command, ...args].map(quoteArgument).join(' ');
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function assertProjectTemplateSmokeCoverage(templates) {
  const catalogIds = templates.map(template => template.id);
  const catalogSet = new Set(catalogIds);
  const smokeSet = new Set(PROJECT_TEMPLATE_SMOKE_IDS);
  const duplicateCatalogIds = catalogIds.filter((id, index) => catalogIds.indexOf(id) !== index);
  const missing = catalogIds.filter(id => !smokeSet.has(id));
  const unknown = PROJECT_TEMPLATE_SMOKE_IDS.filter(id => !catalogSet.has(id));

  if (duplicateCatalogIds.length > 0 || missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `Project template smoke coverage drifted (duplicates: ${duplicateCatalogIds.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'})`
    );
  }
}

export async function loadCuratedProjectTemplates(repoRoot) {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [path.join(repoRoot, 'src/renderer/data/projectTemplates/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    write: false,
    logLevel: 'silent',
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw new Error('esbuild did not produce the curated project template catalog');
  }

  const encoded = Buffer.from(output).toString('base64');
  const catalog = await import(`data:text/javascript;base64,${encoded}`);
  if (!Array.isArray(catalog.PROJECT_TEMPLATES)) {
    throw new Error('The curated project template catalog did not export PROJECT_TEMPLATES');
  }
  return catalog.PROJECT_TEMPLATES;
}

export async function materializeProjectTemplate(template, destination) {
  await mkdir(destination, { recursive: true });
  for (const file of template.files) {
    const absolutePath = path.join(destination, ...file.relPath.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content, 'utf8');
  }
}

async function terminateProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  await new Promise(resolve => setTimeout(resolve, 750));
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function spawnCaptured(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });

  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  return {
    child,
    exited,
    output: () => ({ stdout: trimLog(stdout), stderr: trimLog(stderr) }),
  };
}

async function runCommand(command, args, options = {}) {
  const startedAt = performance.now();
  const capture = spawnCaptured(command, args, options);
  let timeoutId;
  try {
    const result = await Promise.race([
      capture.exited,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${formatCommand(command, args)} timed out after ${options.timeoutMs ?? COMMAND_TIMEOUT_MS}ms`
            )
          );
        }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
      }),
    ]);
    const output = capture.output();
    const step = {
      command: formatCommand(command, args),
      durationMs: Math.round(performance.now() - startedAt),
      exitCode: result.code,
      signal: result.signal,
      ...output,
    };
    if (result.code !== 0) {
      throw Object.assign(
        new Error(
          `${step.command} exited with ${result.code ?? result.signal ?? 'an unknown status'}\n${output.stderr || output.stdout}`
        ),
        { step }
      );
    }
    return step;
  } catch (error) {
    await terminateProcessTree(capture.child);
    if (error && typeof error === 'object' && !('step' in error)) {
      error.step = {
        command: formatCommand(command, args),
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: capture.child.exitCode,
        signal: capture.child.signalCode,
        ...capture.output(),
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
  if (!port) throw new Error('Could not reserve a loopback port');
  return port;
}

async function waitForResponse(url, server, validate, timeoutMs = SERVER_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      const output = server.output();
      throw new Error(
        `Server exited before ${url} became ready\n${output.stderr || output.stdout}`
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        await validate(response);
        return;
      }
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`${url} did not become ready: ${toErrorMessage(lastError)}`);
}

async function installNodeProject(root, steps) {
  steps.push(
    await runCommand(
      commandName('npm'),
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      {
        cwd: root,
        env: { ...process.env, CI: 'true' },
      }
    )
  );
}

function virtualEnvironmentPython(root) {
  return process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
}

async function installPythonProject(root, pythonExecutable, steps) {
  steps.push(
    await runCommand(pythonExecutable, ['-m', 'venv', '.venv'], {
      cwd: root,
    })
  );
  const venvPython = virtualEnvironmentPython(root);
  steps.push(
    await runCommand(
      venvPython,
      [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        '-r',
        'requirements.txt',
      ],
      {
        cwd: root,
        env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' },
      }
    )
  );
  return venvPython;
}

async function smokeExpress(root, context) {
  await installNodeProject(root, context.steps);
  const port = await reserveLoopbackPort();
  const server = spawnCaptured(commandName('npm'), ['--silent', 'start'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CI: 'true' },
  });
  const startedAt = performance.now();
  try {
    await waitForResponse(`http://127.0.0.1:${port}/hello`, server, async response => {
      const body = await response.json();
      if (body?.message !== 'Hello from Lingua + Express!') {
        throw new Error(`Unexpected Express response: ${JSON.stringify(body)}`);
      }
    });
    context.steps.push({
      command: `npm start -> GET /hello`,
      durationMs: Math.round(performance.now() - startedAt),
      exitCode: null,
      signal: null,
      ...server.output(),
    });
  } finally {
    await terminateProcessTree(server.child);
  }
  return 'GET /hello returned the curated JSON greeting';
}

async function smokeNodeCli(root, context) {
  await installNodeProject(root, context.steps);
  const step = await runCommand(process.execPath, ['bin/cli.js', '--name', 'Lingua'], {
    cwd: root,
  });
  context.steps.push(step);
  if (step.stdout.trim() !== 'Hello, Lingua!') {
    throw new Error(`Unexpected CLI output: ${JSON.stringify(step.stdout.trim())}`);
  }
  return 'The generated CLI parsed --name and printed the expected greeting';
}

async function smokeReact(root, context) {
  await installNodeProject(root, context.steps);
  context.steps.push(
    await runCommand(commandName('npm'), ['--silent', 'run', 'build'], {
      cwd: root,
      env: { ...process.env, CI: 'true' },
    })
  );

  const assetsDir = path.join(root, 'dist', 'assets');
  const assets = await readdir(assetsDir);
  const javascriptAssets = assets.filter(name => name.endsWith('.js'));
  if (javascriptAssets.length === 0) {
    throw new Error('The React template build produced no JavaScript asset');
  }
  const bundles = await Promise.all(
    javascriptAssets.map(name => readFile(path.join(assetsDir, name), 'utf8'))
  );
  if (!bundles.some(bundle => bundle.includes('Hello from Lingua + React'))) {
    throw new Error('The React template build omitted the Counter component greeting');
  }

  const port = await reserveLoopbackPort();
  const server = spawnCaptured(
    commandName('npm'),
    ['--silent', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: root, env: { ...process.env, CI: 'true' } }
  );
  const startedAt = performance.now();
  try {
    await waitForResponse(`http://127.0.0.1:${port}/`, server, async response => {
      const html = await response.text();
      if (!html.includes('/src/main.tsx') || !html.includes('id="root"')) {
        throw new Error('The Vite dev server did not serve the generated React entry point');
      }
    });
    context.steps.push({
      command: 'npm run dev -> GET /',
      durationMs: Math.round(performance.now() - startedAt),
      exitCode: null,
      signal: null,
      ...server.output(),
    });
  } finally {
    await terminateProcessTree(server.child);
  }
  return 'TypeScript compiled, Vite built the Counter, and the dev server served its entry point';
}

async function smokeFastApi(root, context) {
  const python = await installPythonProject(root, context.pythonExecutable, context.steps);
  const port = await reserveLoopbackPort();
  const server = spawnCaptured(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1' } }
  );
  const startedAt = performance.now();
  try {
    await waitForResponse(
      `http://127.0.0.1:${port}/hello`,
      server,
      async response => {
        const body = await response.json();
        if (body?.message !== 'Hello from Lingua + FastAPI!') {
          throw new Error(`Unexpected FastAPI response: ${JSON.stringify(body)}`);
        }
      },
      45_000
    );
    context.steps.push({
      command: 'python -m uvicorn app.main:app -> GET /hello',
      durationMs: Math.round(performance.now() - startedAt),
      exitCode: null,
      signal: null,
      ...server.output(),
    });
  } finally {
    await terminateProcessTree(server.child);
  }
  return 'Uvicorn served the FastAPI route and returned the curated JSON greeting';
}

async function smokePythonData(root, context) {
  const python = await installPythonProject(root, context.pythonExecutable, context.steps);
  const step = await runCommand(python, ['explore.py'], { cwd: root });
  context.steps.push(step);
  for (const expected of ['Rows: 4', 'Mean age: 47.0', 'Linus', 'Grace']) {
    if (!step.stdout.includes(expected)) {
      throw new Error(`Python data output was missing ${JSON.stringify(expected)}`);
    }
  }
  return 'Pandas loaded the CSV and produced the expected row count, mean, and records';
}

const SMOKE_RUNNERS = Object.freeze({
  'express-api-hello': smokeExpress,
  'fastapi-hello': smokeFastApi,
  'node-cli-argparse': smokeNodeCli,
  'react-component-sandbox': smokeReact,
  'python-data-explorer': smokePythonData,
});

export async function runProjectTemplateRuntimeSmoke({
  templates,
  workingRoot,
  pythonExecutable = process.env.PYTHON || 'python3',
  onProgress = () => {},
}) {
  assertProjectTemplateSmokeCoverage(templates);
  const summaries = [];

  for (const template of templates) {
    const startedAt = performance.now();
    const root = path.join(workingRoot, template.id);
    const context = { pythonExecutable, steps: [] };
    onProgress({ type: 'started', templateId: template.id });
    try {
      await materializeProjectTemplate(template, root);
      const message = await SMOKE_RUNNERS[template.id](root, context);
      const summary = {
        templateId: template.id,
        ok: true,
        durationMs: Math.round(performance.now() - startedAt),
        message,
        steps: context.steps,
      };
      summaries.push(summary);
      onProgress({ type: 'completed', ...summary });
    } catch (error) {
      if (error && typeof error === 'object' && error.step) {
        context.steps.push(error.step);
      }
      const summary = {
        templateId: template.id,
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
        message: toErrorMessage(error),
        steps: context.steps,
      };
      summaries.push(summary);
      onProgress({ type: 'completed', ...summary });
    }
  }

  return summaries;
}
