/**
 * Desktop project-test discovery and execution.
 *
 * The renderer selects only a closed-enum framework. Main owns every argv,
 * resolves the approved project root through IPC before reaching this module,
 * re-runs detection before every spawn, and never enables a shell. Tests are
 * still arbitrary project code, so the renderer pairs the explicit Run action
 * with a persistent trust warning.
 */

import {
  appendProjectTestOutput,
  type ProjectTestTranscript,
  PROJECT_TEST_MAX_OUTPUT_BYTES,
  PROJECT_TEST_OUTPUT_TRUNCATION_MARKER as OUTPUT_TRUNCATION_MARKER,
} from '../shared/projectTestOutput';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createGoTestCollector,
  parseCargoTestOutput,
  parseJestStyleReport,
  parsePytestJunit,
  type ParsedProjectTestCases,
} from './projectTestReports';
import { detectNode } from './node-runner';
import type {
  ProjectTestCandidate,
  ProjectTestDetectionResult,
  ProjectTestFramework,
  ProjectTestRunResult,
  ProjectTestScope,
} from '../shared/projectTests';
import {
  isProjectTestFramework,
  isProjectTestRelativePath,
  isProjectTestRunId,
  parseProjectTestScope,
} from '../shared/projectTests';
import { resolvePythonInterpreter } from '../shared/python/interpreter';
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
import { resolveHostExecutable } from './runners/hostExecutable';

const PROJECT_TEST_TIMEOUT_MS = 5 * 60 * 1000;
const PROJECT_TEST_KILL_ESCALATION_MS = 300;
const CONFIG_READ_LIMIT_BYTES = 512 * 1024;
const REPORT_READ_LIMIT_BYTES = 16 * 1024 * 1024;
// go test -json repeats each line inside an event; the raw stream needs room.
const GO_JSON_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

type ProjectTestReport = 'jest-json' | 'pytest-junit' | 'go-json' | 'cargo-text';

interface ProjectTestExecutionSpec {
  candidate: ProjectTestCandidate;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  report: ProjectTestReport;
  /** Arguments that write the report and narrow the run; null when the scope cannot be expressed. */
  scopedArgs: (scope: ProjectTestScope, reportFile: string) => string[] | null;
  modulePath?: string;
}

/** A literal match for a runner that only takes a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function exactPattern(text: string): string {
  return `^${escapeRegExp(text)}$`;
}

/** Vitest joins suite and test names with ` > ` since v3, a space before. */
function vitestNamePattern(path: string[]): string {
  return `^${path.map(escapeRegExp).join('(?: | > )')}$`;
}

function cargoTargetArgs(file: string): string[] | null {
  if (file === 'src/lib.rs') return ['--lib'];
  if (file === 'src/main.rs') return ['--bins'];
  const integration = /^tests\/([\w-]+)\.rs$/u.exec(file);
  if (integration) return ['--test', integration[1]!];
  const binary = /^src\/bin\/([\w-]+)\.rs$/u.exec(file);
  if (binary) return ['--bin', binary[1]!];
  return null;
}

interface ProjectTestRuntimeOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: (options: SpawnNativeRunOptions) => Promise<SpawnNativeRunResult>;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  signal?: AbortSignal;
  /** Unvalidated renderer input; absent means the whole suite. */
  scope?: unknown;
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

/**
 * Candidate order is the shared policy; the probe stays local because this
 * surface resolves PATH names through `resolveHostExecutable`, which only
 * accepts absolute PATH segments (a relative one would resolve against the
 * untrusted project directory).
 *
 * No walk-up: this surface is handed a project root, not an arbitrary cwd.
 */
async function pythonExecutable(
  rootPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<string | null> {
  return resolvePythonInterpreter({ startDirectory: rootPath, platform, env }, async candidate => {
    if (candidate.source === 'path') {
      return resolveHostExecutable([candidate.command], env, platform);
    }
    return (await fileExists(candidate.command, platform !== 'win32')) ? candidate.command : null;
  });
}

function candidate(
  framework: ProjectTestFramework,
  command: string,
  evidence: string[],
  available: boolean,
  unavailableReason?: ProjectTestCandidate['unavailableReason']
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
            unavailableReason ??
            (framework === 'vitest' || framework === 'jest'
              ? 'dependencies-not-installed'
              : 'toolchain-not-found'),
        }),
  };
}

function absoluteNodePath(env: NodeJS.ProcessEnv, node?: string | null): string {
  return [node ? path.dirname(node) : '', ...(env.PATH ?? '').split(path.delimiter)]
    .filter(directory => path.isAbsolute(directory))
    .join(path.delimiter);
}

// Only resolved binaries are cached, so a newly installed Node is found on the
// next detection without restarting.
const projectNodeCache = new Map<string, string>();

export function resetProjectNodeCacheForTests(): void {
  projectNodeCache.clear();
}

/** Resolve before changing cwd: a bare node plus a relative PATH could execute
 * a project-planted binary. Reuse native Node discovery for GUI-launch fallback
 * locations, but keep both its probe and the eventual runner PATH absolute. */
async function projectNodeExecutable(
  hostEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  signal?: AbortSignal
): Promise<string | null> {
  // detectNode treats its argument as explicit user overrides. Passing the
  // whole host environment here would bypass its allowlist during --version.
  const env = Object.fromEntries(
    Object.entries(
      buildNativeRunnerEnv(combinedAllowlist(NODE_TOOLCHAIN_KEYS, platform), undefined, {}, hostEnv)
    ).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
  env.PATH = absoluteNodePath(hostEnv);
  const cacheKey = JSON.stringify([platform, env]);
  const cached = projectNodeCache.get(cacheKey);
  if (cached && (await fileExists(cached, platform !== 'win32'))) return cached;
  const detected = await detectNode(env, false, signal);
  if (!detected.installed || !detected.binary) return null;
  const binary = path.isAbsolute(detected.binary)
    ? detected.binary
    : await resolveHostExecutable([detected.binary], env, platform);
  if (binary && !signal?.aborted) projectNodeCache.set(cacheKey, binary);
  return binary;
}

async function executionSpecs(
  rootPath: string,
  options: ProjectTestRuntimeOptions = {}
): Promise<ProjectTestExecutionSpec[]> {
  const platform = options.platform ?? process.platform;
  const hostEnv = options.env ?? process.env;
  const manifest = await packageManifest(rootPath);
  const specs: ProjectTestExecutionSpec[] = [];
  let nodeProbe: Promise<string | null> | undefined;
  const getNode = () => (nodeProbe ??= projectNodeExecutable(hostEnv, platform, options.signal));

  const vitestEvidence = await existingNames(rootPath, VITEST_CONFIGS);
  if (manifest && dependencyMentions(manifest, 'vitest'))
    vitestEvidence.push('package.json#vitest');
  if (manifest && scriptMentions(manifest, 'vitest')) vitestEvidence.push('package.json#scripts');
  if (vitestEvidence.length > 0) {
    const entry = path.join(rootPath, 'node_modules', 'vitest', 'vitest.mjs');
    const installed = await fileExists(entry);
    const node = installed ? await getNode() : null;
    const available = installed && node !== null;
    const env = buildNativeRunnerEnv(
      combinedAllowlist(NODE_TOOLCHAIN_KEYS, platform),
      undefined,
      {
        CI: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        VITEST_SKIP_INSTALL_CHECKS: '1',
      },
      { ...hostEnv, PATH: absoluteNodePath(hostEnv, node) }
    );
    specs.push({
      candidate: candidate(
        'vitest',
        'vitest run --no-color',
        vitestEvidence,
        available,
        installed ? 'node-not-found' : 'dependencies-not-installed'
      ),
      command: node ?? '',
      args: [entry, 'run', '--no-color'],
      env,
      report: 'jest-json',
      scopedArgs: (scope, reportFile) => [
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${reportFile}`,
        ...(scope.kind === 'all' ? [] : [scope.file]),
        ...(scope.kind === 'test' ? ['-t', vitestNamePattern(scope.path)] : []),
      ],
    });
  }

  const jestEvidence = await existingNames(rootPath, JEST_CONFIGS);
  if (manifest && dependencyMentions(manifest, 'jest')) jestEvidence.push('package.json#jest');
  if (manifest && Object.prototype.hasOwnProperty.call(manifest, 'jest'))
    jestEvidence.push('package.json#jest-config');
  if (manifest && scriptMentions(manifest, 'jest')) jestEvidence.push('package.json#scripts');
  if (jestEvidence.length > 0) {
    const entry = path.join(rootPath, 'node_modules', 'jest', 'bin', 'jest.js');
    const installed = await fileExists(entry);
    const node = installed ? await getNode() : null;
    const available = installed && node !== null;
    const env = buildNativeRunnerEnv(
      combinedAllowlist(NODE_TOOLCHAIN_KEYS, platform),
      undefined,
      {
        CI: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      { ...hostEnv, PATH: absoluteNodePath(hostEnv, node) }
    );
    specs.push({
      candidate: candidate(
        'jest',
        'jest --runInBand --colors=false',
        jestEvidence,
        available,
        installed ? 'node-not-found' : 'dependencies-not-installed'
      ),
      command: node ?? '',
      args: [entry, '--runInBand', '--colors=false'],
      env,
      report: 'jest-json',
      scopedArgs: (scope, reportFile) => [
        '--json',
        `--outputFile=${reportFile}`,
        ...(scope.kind === 'all' ? [] : ['--runTestsByPath', scope.file]),
        ...(scope.kind === 'test' ? ['-t', exactPattern(scope.path.join(' '))] : []),
      ],
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
      report: 'pytest-junit',
      scopedArgs: (scope, reportFile) => [
        '-o',
        'junit_family=xunit1',
        `--junitxml=${reportFile}`,
        ...(scope.kind === 'file' ? [scope.file] : []),
        ...(scope.kind === 'test' ? [[scope.file, ...scope.path].join('::')] : []),
      ],
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
    const goMod = await readSmallText(path.join(rootPath, 'go.mod'));
    specs.push({
      candidate: candidate('go', 'go test ./...', ['go.mod'], executable !== null),
      command: executable ?? 'go',
      args: ['test', '-json'],
      env,
      report: 'go-json',
      modulePath: /^module\s+"?([^"\s]+)"?/mu.exec(goMod ?? '')?.[1] ?? '',
      scopedArgs: scope => [
        scope.kind === 'all' ? './...' : scope.file === '.' ? '.' : `./${scope.file}`,
        ...(scope.kind === 'test' ? ['-run', scope.path.map(exactPattern).join('/')] : []),
      ],
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
      report: 'cargo-text',
      scopedArgs: scope => {
        const target = scope.kind === 'all' ? [] : cargoTargetArgs(scope.file);
        // libtest reads the name after `--`, so it must be a Rust path, never an option.
        if (target === null || (scope.kind === 'test' && !scope.path.every(part => /^[A-Za-z_]\w*$/u.test(part)))) {
          return null;
        }
        return [
          '--no-fail-fast',
          ...target,
          ...(scope.kind === 'test' ? ['--', '--exact', scope.path.join('::')] : []),
        ];
      },
    });
  }

  return specs;
}

async function scopeTargetExists(rootPath: string, relative: string): Promise<boolean> {
  try {
    await stat(path.join(rootPath, ...relative.split('/')));
    return true;
  } catch {
    return false;
  }
}

async function readReport(file: string): Promise<string | null> {
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > REPORT_READ_LIMIT_BYTES) return null;
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Reports come from project code: keep only paths that stay inside the root. */
function containedCases(parsed: ParsedProjectTestCases | null): ParsedProjectTestCases | null {
  if (!parsed) return null;
  const cases = parsed.cases
    .filter(entry => isProjectTestRelativePath(entry.file))
    .map(entry => {
      if (entry.failureFile === undefined || isProjectTestRelativePath(entry.failureFile)) return entry;
      const { failureFile: _dropped, failureLine: _line, ...rest } = entry;
      return rest;
    });
  return { cases, truncated: parsed.truncated };
}

async function readProjectTestCases(
  report: ProjectTestReport,
  rootPath: string,
  reportFile: string,
  transcript: string,
  go: ReturnType<typeof createGoTestCollector> | null
): Promise<ParsedProjectTestCases | null> {
  if (report === 'go-json') return go ? go.finish() : null;
  if (report === 'cargo-text') return parseCargoTestOutput(transcript);
  const text = await readReport(reportFile);
  if (text === null) return null;
  if (report === 'pytest-junit') return parsePytestJunit(text);
  const parsed = parseJestStyleReport(text, rootPath);
  if (!parsed || parsed.cases.length > 0) return parsed;
  // Runners report real paths; the approved root may be a symlink to them.
  const real = await realpath(rootPath).catch(() => rootPath);
  return real === rootPath ? parsed : parseJestStyleReport(text, real);
}

export async function detectProjectTests(
  rootPath: string,
  options: ProjectTestRuntimeOptions = {}
): Promise<ProjectTestDetectionResult> {
  const candidates = (await executionSpecs(rootPath, options)).map(spec => spec.candidate);
  return { kind: candidates.length > 0 ? 'ready' : 'none', candidates };
}

export function emptyProjectTestRunResult(
  kind: ProjectTestRunResult['kind'],
  framework: ProjectTestFramework | null,
  timeoutMs: number = PROJECT_TEST_TIMEOUT_MS
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
    !isProjectTestRunId(runId)
  ) {
    return emptyProjectTestRunResult('invalid-request', null, PROJECT_TEST_TIMEOUT_MS);
  }
  if (activeRuns.has(runId)) {
    return emptyProjectTestRunResult('invalid-request', framework, PROJECT_TEST_TIMEOUT_MS);
  }

  const rootKey = normalizedRootKey(rootPath, options.platform);
  if ([...activeRuns.values()].some(active => active.rootKey === rootKey)) {
    return emptyProjectTestRunResult('busy', framework, PROJECT_TEST_TIMEOUT_MS);
  }

  if (options.signal?.aborted) {
    return emptyProjectTestRunResult('stopped', framework, PROJECT_TEST_TIMEOUT_MS);
  }

  // Reserve root and identity before discovery: Stop, owner disposal and
  // concurrent requests must also see runs that are still preparing.
  const controller = new AbortController();
  const stopForOwnerLifecycle = () => controller.abort();
  options.signal?.addEventListener('abort', stopForOwnerLifecycle, { once: true });
  activeRuns.set(runId, { rootKey, controller });
  try {
    const spec = (await executionSpecs(rootPath, { ...options, signal: controller.signal })).find(
      entry => entry.candidate.framework === framework
    );
    if (controller.signal.aborted) {
      return emptyProjectTestRunResult('stopped', framework, PROJECT_TEST_TIMEOUT_MS);
    }
    if (!spec) return emptyProjectTestRunResult('not-detected', framework, PROJECT_TEST_TIMEOUT_MS);
    if (!spec.candidate.available) {
      return {
        ...emptyProjectTestRunResult('unavailable', framework, PROJECT_TEST_TIMEOUT_MS),
        command: spec.candidate.command,
        unavailableReason: spec.candidate.unavailableReason,
      };
    }

    const scope = parseProjectTestScope(options.scope);
    if (!scope || (scope.kind !== 'all' && !(await scopeTargetExists(rootPath, scope.file)))) {
      return emptyProjectTestRunResult('invalid-request', framework, PROJECT_TEST_TIMEOUT_MS);
    }
    const reportDir =
      spec.report === 'jest-json' || spec.report === 'pytest-junit'
        ? await mkdtemp(path.join(os.tmpdir(), 'lingua-tests-'))
        : null;
    try {
      const reportFile = reportDir
        ? path.join(reportDir, spec.report === 'pytest-junit' ? 'report.xml' : 'report.json')
        : '';
      const scopedArgs = spec.scopedArgs(scope, reportFile);
      if (!scopedArgs) {
        return emptyProjectTestRunResult('invalid-request', framework, PROJECT_TEST_TIMEOUT_MS);
      }
      const go = spec.report === 'go-json' ? createGoTestCollector(spec.modulePath ?? '') : null;
      let transcript: ProjectTestTranscript | undefined;
      const shown = { stdout: '', stderr: '' };
      const pipeSizes = { stdout: 0, stderr: 0 };
      const clippedPipes = new Set<'stdout' | 'stderr'>();
      const show = (stream: 'stdout' | 'stderr', chunk: string) => {
        if (!chunk || clippedPipes.has(stream)) return;
        const remaining = PROJECT_TEST_MAX_OUTPUT_BYTES - pipeSizes[stream];
        let text = chunk;
        if (chunk.length > remaining) {
          let end = remaining;
          const last = chunk.charCodeAt(end - 1);
          if (last >= 0xd800 && last <= 0xdbff) end--;
          text = chunk.slice(0, end) + OUTPUT_TRUNCATION_MARKER;
          clippedPipes.add(stream);
        }
        pipeSizes[stream] += chunk.length;
        shown[stream] += text;
        transcript = appendProjectTestOutput(transcript, text);
        options.onOutput?.(stream, text);
      };
      const capture = (stream: 'stdout' | 'stderr', chunk: string) =>
        show(stream, go && stream === 'stdout' ? go.push(chunk) : chunk);
      const execute = options.spawnImpl ?? spawnNativeRun;
      const result = await execute({
        command: spec.command,
        args: [...spec.args, ...scopedArgs],
        cwd: rootPath,
        env: spec.env,
        timeoutMs: PROJECT_TEST_TIMEOUT_MS,
        killEscalationMs: PROJECT_TEST_KILL_ESCALATION_MS,
        maxOutputBytes: go ? GO_JSON_OUTPUT_LIMIT_BYTES : PROJECT_TEST_MAX_OUTPUT_BYTES,
        stdoutTruncationMarker: OUTPUT_TRUNCATION_MARKER,
        stderrTruncationMarker: OUTPUT_TRUNCATION_MARKER,
        signal: controller.signal,
        onStdout: chunk => capture('stdout', chunk),
        onStderr: chunk => capture('stderr', chunk),
      });
      if (go) show('stdout', go.flush());
      const parsed = containedCases(
        await readProjectTestCases(spec.report, rootPath, reportFile, transcript?.text ?? '', go).catch(() => null)
      );
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
        ...(transcript === undefined ? {} : { orderedOutput: transcript.text }),
        // Go's raw cap is larger for its JSON, so return the bounded text that was shown.
        stdout: go ? shown.stdout : result.stdout,
        stderr: (go ? shown.stderr : result.stderr) || result.spawnError?.message || '',
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        timeoutMs: PROJECT_TEST_TIMEOUT_MS,
        ...(result.spawnError
          ? {
              unavailableReason:
                framework === 'vitest' || framework === 'jest'
                  ? ('node-not-found' as const)
                  : ('toolchain-not-found' as const),
            }
          : {}),
        scope,
        ...(parsed ? { cases: parsed.cases, ...(parsed.truncated ? { casesTruncated: true } : {}) } : {}),
      };
    } finally {
      if (reportDir) await rm(reportDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    options.signal?.removeEventListener('abort', stopForOwnerLifecycle);
    if (activeRuns.get(runId)?.controller === controller) activeRuns.delete(runId);
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
