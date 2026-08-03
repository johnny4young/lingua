/**
 * Desktop project-test discovery and execution.
 *
 * The renderer selects only a closed-enum framework. Main owns every argv,
 * resolves the approved project root through IPC before reaching this module,
 * re-runs detection before every spawn, and never enables a shell. Tests are
 * still arbitrary project code, so the renderer pairs the explicit Run action
 * with a persistent trust warning.
 */

import { constants as fsConstants } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProjectTestCandidate,
  ProjectTestDetectionResult,
  ProjectTestFramework,
  ProjectTestRunResult,
} from '../shared/projectTests';
import { isProjectTestFramework } from '../shared/projectTests';
import {
  NODE_TOOLCHAIN_KEYS,
  RUST_TOOLCHAIN_KEYS,
  GO_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';
import {
  spawnNativeRun,
  type SpawnNativeRunOptions,
  type SpawnNativeRunResult,
} from './runners/spawnNativeRun';

const PROJECT_TEST_TIMEOUT_MS = 5 * 60 * 1000;
const PROJECT_TEST_KILL_ESCALATION_MS = 300;
const PROJECT_TEST_MAX_OUTPUT_BYTES = 256 * 1024;
const CONFIG_READ_LIMIT_BYTES = 512 * 1024;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const OUTPUT_TRUNCATION_MARKER = '\n[project test output truncated]';

interface ProjectTestExecutionSpec {
  candidate: ProjectTestCandidate;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

interface ProjectTestRuntimeOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  electronExecutable?: string;
  spawnImpl?: (options: SpawnNativeRunOptions) => Promise<SpawnNativeRunResult>;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  signal?: AbortSignal;
}

interface ActiveProjectTestRun {
  rootKey: string;
  controller: AbortController;
}

const activeRuns = new Map<string, ActiveProjectTestRun>();

function normalizedRootKey(rootPath: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = path.resolve(rootPath);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function fileExists(candidate: string, executable = false): Promise<boolean> {
  try {
    await access(candidate, executable ? fsConstants.X_OK : fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readSmallText(candidate: string): Promise<string | null> {
  try {
    const metadata = await stat(candidate);
    if (!metadata.isFile() || metadata.size > CONFIG_READ_LIMIT_BYTES) return null;
    return await readFile(candidate, 'utf8');
  } catch {
    return null;
  }
}

async function resolveHostExecutable(
  names: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | null> {
  const rawPath = typeof env.PATH === 'string' ? env.PATH : '';
  const windowsExtensions =
    platform === 'win32'
      ? (typeof env.PATHEXT === 'string' ? env.PATHEXT : '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter(Boolean)
      : [''];

  for (const directory of rawPath.split(path.delimiter)) {
    // Empty/relative entries resolve against the untrusted project cwd and
    // would allow binary planting. Only absolute PATH segments are eligible.
    if (!path.isAbsolute(directory)) continue;
    for (const name of names) {
      const variants =
        platform === 'win32' && path.extname(name) === ''
          ? windowsExtensions.map(extension => `${name}${extension.toLowerCase()}`)
          : [name];
      for (const variant of variants) {
        const candidate = path.join(directory, variant);
        if (await fileExists(candidate, platform !== 'win32')) return candidate;
      }
    }
  }
  return null;
}

function dependencyMentions(manifest: Record<string, unknown>, packageName: string): boolean {
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const value = manifest[field];
    if (
      value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, packageName)
    ) {
      return true;
    }
  }
  return false;
}

function scriptMentions(manifest: Record<string, unknown>, command: string): boolean {
  const scripts = manifest.scripts;
  if (!scripts || typeof scripts !== 'object') return false;
  return Object.values(scripts).some(
    value =>
      typeof value === 'string' &&
      new RegExp(`(?:^|[\\s;&|])${command}(?:[\\s;&|]|$)`, 'u').test(value)
  );
}

async function packageManifest(rootPath: string): Promise<Record<string, unknown> | null> {
  const raw = await readSmallText(path.join(rootPath, 'package.json'));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const VITEST_CONFIGS = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
] as const;
const JEST_CONFIGS = [
  'jest.config.ts',
  'jest.config.mts',
  'jest.config.cts',
  'jest.config.js',
  'jest.config.mjs',
  'jest.config.cjs',
  'jest.config.json',
] as const;

async function existingNames(rootPath: string, names: readonly string[]): Promise<string[]> {
  const matches = await Promise.all(
    names.map(async name => ((await fileExists(path.join(rootPath, name))) ? name : null))
  );
  return matches.filter((name): name is string => name !== null);
}

async function pytestFileEvidence(rootPath: string): Promise<string[]> {
  const evidence: string[] = [];
  for (const relativeDirectory of ['', 'tests']) {
    try {
      const entries = await readdir(path.join(rootPath, relativeDirectory), {
        withFileTypes: true,
      });
      const match = entries
        .slice(0, 1_000)
        .find(
          entry =>
            entry.isFile() &&
            (/^test_.+\.py$/u.test(entry.name) || /^.+_test\.py$/u.test(entry.name))
        );
      if (match) evidence.push(path.posix.join(relativeDirectory, match.name));
    } catch {
      // Missing or unreadable conventional test directories are not evidence.
    }
  }
  return evidence;
}

async function pythonExecutable(
  rootPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | null> {
  const localCandidates =
    platform === 'win32'
      ? ['.venv/Scripts/python.exe', 'venv/Scripts/python.exe']
      : ['.venv/bin/python', 'venv/bin/python'];
  for (const relative of localCandidates) {
    const candidate = path.join(rootPath, relative);
    if (await fileExists(candidate, platform !== 'win32')) return candidate;
  }
  return resolveHostExecutable(
    platform === 'win32' ? ['python', 'py'] : ['python3', 'python'],
    env,
    platform
  );
}

function candidate(
  framework: ProjectTestFramework,
  command: string,
  evidence: string[],
  available: boolean
): ProjectTestCandidate {
  return {
    framework,
    command,
    evidence: [...new Set(evidence)],
    available,
    ...(available
      ? {}
      : {
          unavailableReason:
            framework === 'vitest' || framework === 'jest'
              ? ('dependencies-not-installed' as const)
              : ('toolchain-not-found' as const),
        }),
  };
}

async function executionSpecs(
  rootPath: string,
  options: ProjectTestRuntimeOptions = {}
): Promise<ProjectTestExecutionSpec[]> {
  const platform = options.platform ?? process.platform;
  const hostEnv = options.env ?? process.env;
  const manifest = await packageManifest(rootPath);
  const specs: ProjectTestExecutionSpec[] = [];

  const vitestEvidence = await existingNames(rootPath, VITEST_CONFIGS);
  if (manifest && dependencyMentions(manifest, 'vitest'))
    vitestEvidence.push('package.json#vitest');
  if (manifest && scriptMentions(manifest, 'vitest')) vitestEvidence.push('package.json#scripts');
  if (vitestEvidence.length > 0) {
    const entry = path.join(rootPath, 'node_modules', 'vitest', 'vitest.mjs');
    const available = await fileExists(entry);
    const env = buildNativeRunnerEnv(
      combinedAllowlist(NODE_TOOLCHAIN_KEYS, platform),
      undefined,
      {
        CI: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ELECTRON_RUN_AS_NODE: '1',
        VITEST_SKIP_INSTALL_CHECKS: '1',
      },
      hostEnv
    );
    specs.push({
      candidate: candidate('vitest', 'vitest run --no-color', vitestEvidence, available),
      command: options.electronExecutable ?? process.execPath,
      args: [entry, 'run', '--no-color'],
      env,
    });
  }

  const jestEvidence = await existingNames(rootPath, JEST_CONFIGS);
  if (manifest && dependencyMentions(manifest, 'jest')) jestEvidence.push('package.json#jest');
  if (manifest && Object.prototype.hasOwnProperty.call(manifest, 'jest'))
    jestEvidence.push('package.json#jest-config');
  if (manifest && scriptMentions(manifest, 'jest')) jestEvidence.push('package.json#scripts');
  if (jestEvidence.length > 0) {
    const entry = path.join(rootPath, 'node_modules', 'jest', 'bin', 'jest.js');
    const available = await fileExists(entry);
    const env = buildNativeRunnerEnv(
      combinedAllowlist(NODE_TOOLCHAIN_KEYS, platform),
      undefined,
      {
        CI: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ELECTRON_RUN_AS_NODE: '1',
      },
      hostEnv
    );
    specs.push({
      candidate: candidate('jest', 'jest --runInBand --colors=false', jestEvidence, available),
      command: options.electronExecutable ?? process.execPath,
      args: [entry, '--runInBand', '--colors=false'],
      env,
    });
  }

  const pytestEvidence = await existingNames(rootPath, ['pytest.ini', 'conftest.py']);
  for (const [name, marker] of [
    ['pyproject.toml', '[tool.pytest'],
    ['setup.cfg', '[tool:pytest]'],
    ['tox.ini', '[pytest]'],
  ] as const) {
    const contents = await readSmallText(path.join(rootPath, name));
    if (contents?.includes(marker)) pytestEvidence.push(`${name}#${marker}`);
  }
  for (const name of ['requirements.txt', 'requirements-dev.txt'] as const) {
    const contents = await readSmallText(path.join(rootPath, name));
    if (contents && /^\s*pytest(?:\s|[<=>!~])/imu.test(contents))
      pytestEvidence.push(`${name}#pytest`);
  }
  pytestEvidence.push(...(await pytestFileEvidence(rootPath)));
  if (pytestEvidence.length > 0) {
    const executable = await pythonExecutable(rootPath, hostEnv, platform);
    const env = buildNativeRunnerEnv(
      combinedAllowlist([], platform),
      undefined,
      {
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        PYTHONUNBUFFERED: '1',
      },
      hostEnv
    );
    specs.push({
      candidate: candidate(
        'pytest',
        'python -m pytest -q --color=no',
        pytestEvidence,
        executable !== null
      ),
      command: executable ?? 'python',
      args: ['-m', 'pytest', '-q', '--color=no'],
      env,
    });
  }

  if (await fileExists(path.join(rootPath, 'go.mod'))) {
    const env = buildNativeRunnerEnv(
      combinedAllowlist(GO_TOOLCHAIN_KEYS, platform),
      undefined,
      { NO_COLOR: '1' },
      hostEnv
    );
    const executable = await resolveHostExecutable(['go'], env, platform);
    specs.push({
      candidate: candidate('go', 'go test ./...', ['go.mod'], executable !== null),
      command: executable ?? 'go',
      args: ['test', './...'],
      env,
    });
  }

  if (await fileExists(path.join(rootPath, 'Cargo.toml'))) {
    const env = buildNativeRunnerEnv(
      combinedAllowlist(RUST_TOOLCHAIN_KEYS, platform),
      undefined,
      {
        CARGO_TERM_COLOR: 'never',
        NO_COLOR: '1',
      },
      hostEnv
    );
    const executable = await resolveHostExecutable(['cargo'], env, platform);
    specs.push({
      candidate: candidate(
        'cargo',
        'cargo test --color never',
        ['Cargo.toml'],
        executable !== null
      ),
      command: executable ?? 'cargo',
      args: ['test', '--color', 'never'],
      env,
    });
  }

  return specs;
}

export async function detectProjectTests(
  rootPath: string,
  options: ProjectTestRuntimeOptions = {}
): Promise<ProjectTestDetectionResult> {
  const candidates = (await executionSpecs(rootPath, options)).map(spec => spec.candidate);
  return { kind: candidates.length > 0 ? 'ready' : 'none', candidates };
}

function emptyRunResult(
  kind: ProjectTestRunResult['kind'],
  framework: ProjectTestFramework | null,
  timeoutMs: number
): ProjectTestRunResult {
  return {
    kind,
    framework,
    command: '',
    stdout: '',
    stderr: '',
    exitCode: -1,
    executionTime: 0,
    timeoutMs,
  };
}

export async function runProjectTests(
  rootPath: string,
  framework: unknown,
  runId: unknown,
  options: ProjectTestRuntimeOptions = {}
): Promise<ProjectTestRunResult> {
  if (
    !isProjectTestFramework(framework) ||
    typeof runId !== 'string' ||
    !RUN_ID_PATTERN.test(runId)
  ) {
    return emptyRunResult('invalid-request', null, PROJECT_TEST_TIMEOUT_MS);
  }
  if (activeRuns.has(runId)) {
    return emptyRunResult('invalid-request', framework, PROJECT_TEST_TIMEOUT_MS);
  }

  const rootKey = normalizedRootKey(rootPath, options.platform);
  if ([...activeRuns.values()].some(active => active.rootKey === rootKey)) {
    return emptyRunResult('busy', framework, PROJECT_TEST_TIMEOUT_MS);
  }

  const spec = (await executionSpecs(rootPath, options)).find(
    entry => entry.candidate.framework === framework
  );
  if (!spec) return emptyRunResult('not-detected', framework, PROJECT_TEST_TIMEOUT_MS);
  if (!spec.candidate.available) {
    return {
      ...emptyRunResult('unavailable', framework, PROJECT_TEST_TIMEOUT_MS),
      command: spec.candidate.command,
      unavailableReason: spec.candidate.unavailableReason,
    };
  }

  // The renderer may disappear while runner detection is still awaiting the
  // filesystem. Do not spawn after its lifecycle signal has already fired.
  if (options.signal?.aborted) {
    return emptyRunResult('stopped', framework, PROJECT_TEST_TIMEOUT_MS);
  }

  const controller = new AbortController();
  const stopForOwnerLifecycle = () => controller.abort();
  options.signal?.addEventListener('abort', stopForOwnerLifecycle, { once: true });
  activeRuns.set(runId, { rootKey, controller });
  try {
    const execute = options.spawnImpl ?? spawnNativeRun;
    const result = await execute({
      command: spec.command,
      args: spec.args,
      cwd: rootPath,
      env: spec.env,
      timeoutMs: PROJECT_TEST_TIMEOUT_MS,
      killEscalationMs: PROJECT_TEST_KILL_ESCALATION_MS,
      maxOutputBytes: PROJECT_TEST_MAX_OUTPUT_BYTES,
      stdoutTruncationMarker: OUTPUT_TRUNCATION_MARKER,
      stderrTruncationMarker: OUTPUT_TRUNCATION_MARKER,
      signal: controller.signal,
      onStdout: chunk => options.onOutput?.('stdout', chunk),
      onStderr: chunk => options.onOutput?.('stderr', chunk),
    });
    const kind: ProjectTestRunResult['kind'] = result.killed
      ? 'stopped'
      : result.timedOut
        ? 'timed-out'
        : result.spawnError
          ? 'unavailable'
          : result.exitCode === 0
            ? 'success'
            : 'failed';
    return {
      kind,
      framework,
      command: spec.candidate.command,
      stdout: result.stdout,
      stderr: result.stderr || result.spawnError?.message || '',
      exitCode: result.exitCode,
      executionTime: result.executionTime,
      timeoutMs: PROJECT_TEST_TIMEOUT_MS,
      ...(result.spawnError
        ? {
            unavailableReason:
              framework === 'vitest' || framework === 'jest'
                ? ('dependencies-not-installed' as const)
                : ('toolchain-not-found' as const),
          }
        : {}),
    };
  } finally {
    options.signal?.removeEventListener('abort', stopForOwnerLifecycle);
    activeRuns.delete(runId);
  }
}

export function stopProjectTests(rootPath: string, runId: unknown): boolean {
  if (typeof runId !== 'string') return false;
  const active = activeRuns.get(runId);
  if (!active || active.rootKey !== normalizedRootKey(rootPath)) return false;
  active.controller.abort();
  return true;
}

export function disposeProjectTestRuns(): void {
  for (const active of activeRuns.values()) active.controller.abort();
  activeRuns.clear();
}
