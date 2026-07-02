/**
 * RL-019 Slice 2 — desktop Node child-spawn backend.
 *
 * The renderer-side `NodeRunner` (`src/renderer/runners/nodeRunner.ts`)
 * calls `window.lingua.node.run(code, options)` and the preload
 * bridge forwards to `typedHandle('node:run', ...)` registered
 * by `registerNodeJSHandlers()` below.
 *
 * Security posture:
 *
 *   - `spawn()` only — never the shell-evaluating sibling. User
 *     code is passed either as an `-e` argv element (when ≤ 4 KB)
 *     or written to a freshly-created temp file and passed by path.
 *     We never interpolate user input into a shell command line,
 *     so command injection is impossible at this layer.
 *   - Env: `buildNativeRunnerEnv(['PATH', 'HOME', 'LANG',
 *     'TMPDIR'] + NODE_TOOLCHAIN_KEYS, userEnv)`. RL-079 allowlist
 *     + RL-011 user-tier env. Lingua's full host env is NOT
 *     forwarded.
 *   - Cwd: `app.getPath('temp')` for unsaved tabs (Scratchpad);
 *     `path.dirname(filePath)` for saved tabs (fold F — when a
 *     `node_modules/` neighbor exists, that dir wins so
 *     `require('lodash')` resolves).
 *   - Timeout: parent-owned. The renderer sets a per-call
 *     timeout; we send SIGTERM and escalate to SIGKILL after
 *     200 ms if the child hasn't exited.
 *   - Output caps: stdout / stderr each capped at
 *     `MAX_NATIVE_STDERR_BYTES` (1 MiB) with the existing
 *     `truncateBytes` helper.
 *
 * Folds shipped here:
 *
 *   - Fold A — `runtime.node_runner_used` adoption telemetry is
 *     emitted on the renderer side (where i18n lives); main just
 *     returns the kind + outcome.
 *   - Fold F — module-resolution helper: `resolveNodeCwd()` walks
 *     up from the saved tab's `filePath` directory looking for
 *     `node_modules/`; if found, that dir is the cwd.
 *   - Fold G — module-mode selection: explicit ESM/CJS extensions,
 *     source syntax (`import` / `export` / top-level `await` /
 *     `import.meta`), and the nearest `package.json#type` pick the
 *     `--input-type` mode used by inline snippets and temp files.
 */

import { app } from 'electron';
import { typedHandle } from './ipc/typedHandle';
import { parse } from 'acorn';
import type { Node as AcornNode, Program as AcornProgram } from 'acorn';
import * as childProc from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  MAX_NATIVE_STDERR_BYTES,
  truncateBytes,
} from '../shared/runnerLimits';
import {
  NODE_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from './runners/nativeEnv';
import { detachedSpawnOptions, killProcessTree } from './runners/processTree';

const execFileAsync = promisify(childProc.execFile);

/**
 * Source-size threshold above which we write a temp file instead of
 * passing user code as an `-e` argv element. The 4 KB boundary is
 * generous — shell-arg limits on POSIX are typically 128 KB, but
 * Windows command lines top out at 8 KB and we want a single code
 * path for both platforms.
 */
const NODE_INLINE_CODE_MAX_BYTES = 4 * 1024;

/**
 * SIGTERM → SIGKILL escalation window. If the child has not exited
 * within this window of the timer firing, we escalate. Matches the
 * Rust runner's timeout semantics.
 */
const KILL_ESCALATION_DELAY_MS = 200;

/**
 * Default parent-owned timeout for a single Node run. The renderer
 * always passes an explicit `timeout` (Slice 7 plumbing), but main
 * defends with a sensible default if the IPC was malformed.
 */
const DEFAULT_NODE_TIMEOUT_MS = 30_000;
const NODE_DETECT_TIMEOUT_MS = 5_000;

/**
 * Packaged GUI launches can inherit a narrower PATH than the user's terminal:
 * macOS apps opened through Finder/LaunchServices are the common failure case,
 * but Linux desktop files and Windows shortcuts can also miss shell-managed
 * version managers. Keep the first probe as plain `node` for normal PATH-aware
 * launches, then walk common absolute install locations without evaluating
 * shell startup files.
 */
const DARWIN_SYSTEM_NODE_FALLBACK_PATHS = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/opt/local/bin/node',
  '/usr/bin/node',
] as const;
const LINUX_SYSTEM_NODE_FALLBACK_PATHS = [
  '/usr/local/bin/node',
  '/usr/bin/node',
  '/bin/node',
  '/snap/bin/node',
  '/opt/node/bin/node',
  '/opt/nodejs/bin/node',
] as const;

const RUNTIME_STDOUT_TRUNCATION_MARKER = '\n[stdout truncated]';
const RUNTIME_STDERR_TRUNCATION_MARKER = '\n[stderr truncated]';

function truncationMarkers(messages?: NativeRunnerMessages) {
  return {
    stdout: messages?.stdoutTruncated
      ? `\n${messages.stdoutTruncated}`
      : RUNTIME_STDOUT_TRUNCATION_MARKER,
    stderr: messages?.stderrTruncated
      ? `\n${messages.stderrTruncated}`
      : RUNTIME_STDERR_TRUNCATION_MARKER,
  };
}

export type NodeRunKind =
  | 'success'
  | 'error'
  | 'timeout'
  | 'stopped'
  | 'missing-binary';

export interface NodeDetectResult {
  installed: boolean;
  /** Binary used for future runs; absolute when resolved via GUI fallbacks. */
  binary?: string;
  version?: string;
  error?: string;
}

export interface NodeRunOptions {
  /**
   * Renderer-minted correlation id. Lets `node:stop` terminate the
   * exact child process backing the active UI run.
   */
  runId?: string;
  /** Per-call timeout (ms). Defaults to 30 s when omitted. */
  timeoutMs?: number;
  /** Source-file path of the active tab. `undefined` for Scratchpad. */
  filePath?: string;
  /** Per-run user-env tier from RL-011. */
  userEnv?: Record<string, string>;
  /** Stdin buffer (Slice 6). Empty / undefined closes stdin. */
  stdin?: string;
  /** I18n-keyed truncation markers. */
  messages?: NativeRunnerMessages;
}

export interface NodeRunResult {
  kind: NodeRunKind;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
  /** ms reserved by the parent timer (echoed back for `<RunStatusPill>` tooltip). */
  timeoutMs: number;
}

let cachedDetect: NodeDetectResult | null = null;
const activeNodeRuns = new Map<string, () => void>();

function envValue(
  key: string,
  userEnv?: Record<string, string>
): string | undefined {
  return userEnv?.[key] || process.env[key];
}

function homeDirForNodeCandidates(userEnv?: Record<string, string>): string {
  return (
    envValue('HOME', userEnv) ||
    envValue('USERPROFILE', userEnv) ||
    homedir()
  );
}

function normalizeVersionLabel(label: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(label);
  if (!match) return null;
  return [
    Number.parseInt(match[1] ?? '0', 10),
    Number.parseInt(match[2] ?? '0', 10),
    Number.parseInt(match[3] ?? '0', 10),
  ];
}

function compareVersionLabels(a: string, b: string): number {
  const parsedA = normalizeVersionLabel(a);
  const parsedB = normalizeVersionLabel(b);
  if (!parsedA && !parsedB) return a.localeCompare(b);
  if (!parsedA) return -1;
  if (!parsedB) return 1;
  const [majorA, minorA, patchA] = parsedA;
  const [majorB, minorB, patchB] = parsedB;
  for (const [left, right] of [
    [majorA, majorB],
    [minorA, minorB],
    [patchA, patchB],
  ] as const) {
    const delta = left - right;
    if (delta !== 0) return delta;
  }
  return 0;
}

function installedNodeVersionCandidates(
  root: string,
  nodePathFromVersion: (version: string) => string
): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root)
      .filter((entry) => normalizeVersionLabel(entry) !== null)
      .sort((a, b) => compareVersionLabels(b, a))
      .map(nodePathFromVersion);
  } catch {
    return [];
  }
}

function nvmDefaultNodeCandidate(root: string): string | null {
  const aliasPath = path.join(root, 'alias', 'default');
  if (!existsSync(aliasPath)) return null;
  try {
    const alias = readFileSync(aliasPath, 'utf-8').trim();
    if (!alias || alias === 'node' || alias === 'stable') return null;
    const version = alias.startsWith('v') ? alias : `v${alias}`;
    return path.join(root, 'versions', 'node', version, 'bin', 'node');
  } catch {
    return null;
  }
}

function appendNodeExecutable(directory: string | undefined): string | null {
  if (!directory) return null;
  return path.join(
    directory,
    process.platform === 'win32' ? 'node.exe' : 'node'
  );
}

function posixNodeBinaryCandidates(
  userEnv?: Record<string, string>
): Array<string | null> {
  const home = homeDirForNodeCandidates(userEnv);
  const nvmRoot = envValue('NVM_DIR', userEnv) || path.join(home, '.nvm');
  const xdgDataHome = envValue('XDG_DATA_HOME', userEnv) || path.join(home, '.local', 'share');
  const fnmRoots = [
    envValue('FNM_DIR', userEnv),
    path.join(xdgDataHome, 'fnm'),
    path.join(home, '.local', 'share', 'fnm'),
    path.join(home, 'Library', 'Application Support', 'fnm'),
    path.join(home, '.fnm'),
  ].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  const nodenvRoot = envValue('NODENV_ROOT', userEnv) || path.join(home, '.nodenv');

  return [
    path.join(home, '.volta', 'bin', 'node'),
    ...fnmRoots.map((root) => path.join(root, 'aliases', 'default', 'bin', 'node')),
    nvmDefaultNodeCandidate(nvmRoot),
    path.join(home, '.asdf', 'shims', 'node'),
    path.join(home, '.local', 'share', 'mise', 'shims', 'node'),
    path.join(nodenvRoot, 'shims', 'node'),
    path.join(home, '.nodebrew', 'current', 'bin', 'node'),
    path.join(home, '.local', 'bin', 'node'),
    ...(process.platform === 'darwin' ? DARWIN_SYSTEM_NODE_FALLBACK_PATHS : []),
    ...(process.platform === 'linux' ? LINUX_SYSTEM_NODE_FALLBACK_PATHS : []),
    ...fnmRoots.flatMap((root) =>
      installedNodeVersionCandidates(
        path.join(root, 'node-versions'),
        (version) => path.join(root, 'node-versions', version, 'installation', 'bin', 'node')
      )
    ),
    ...installedNodeVersionCandidates(
      path.join(nvmRoot, 'versions', 'node'),
      (version) => path.join(nvmRoot, 'versions', 'node', version, 'bin', 'node')
    ),
    ...installedNodeVersionCandidates(
      path.join(nodenvRoot, 'versions'),
      (version) => path.join(nodenvRoot, 'versions', version, 'bin', 'node')
    ),
  ];
}

function windowsNodeBinaryCandidates(
  userEnv?: Record<string, string>
): Array<string | null> {
  const home = homeDirForNodeCandidates(userEnv);
  const appData = envValue('APPDATA', userEnv);
  const localAppData = envValue('LOCALAPPDATA', userEnv);
  const programFiles = envValue('ProgramFiles', userEnv);
  const programFilesX86 = envValue('ProgramFiles(x86)', userEnv);
  const programData = envValue('ProgramData', userEnv) || 'C:\\ProgramData';
  const chocolateyInstall = envValue('ChocolateyInstall', userEnv);
  const nvmHome = envValue('NVM_HOME', userEnv) || (appData ? path.join(appData, 'nvm') : undefined);
  const nvmSymlink = envValue('NVM_SYMLINK', userEnv);
  const fnmRoots = [
    envValue('FNM_DIR', userEnv),
    localAppData ? path.join(localAppData, 'fnm') : undefined,
    appData ? path.join(appData, 'fnm') : undefined,
  ].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);

  return [
    appendNodeExecutable(nvmSymlink),
    appendNodeExecutable(localAppData ? path.join(localAppData, 'Volta', 'bin') : undefined),
    appendNodeExecutable(programFiles ? path.join(programFiles, 'nodejs') : undefined),
    appendNodeExecutable(programFilesX86 ? path.join(programFilesX86, 'nodejs') : undefined),
    appendNodeExecutable(localAppData ? path.join(localAppData, 'Programs', 'nodejs') : undefined),
    appendNodeExecutable(chocolateyInstall ? path.join(chocolateyInstall, 'bin') : undefined),
    appendNodeExecutable(path.join(programData, 'chocolatey', 'bin')),
    appendNodeExecutable(path.join(home, 'scoop', 'shims')),
    appendNodeExecutable(path.join(programData, 'scoop', 'shims')),
    appendNodeExecutable(localAppData ? path.join(localAppData, 'mise', 'shims') : undefined),
    appendNodeExecutable(path.join(home, '.asdf', 'shims')),
    appendNodeExecutable(localAppData ? path.join(localAppData, 'Nodist', 'bin') : undefined),
    appendNodeExecutable(programFiles ? path.join(programFiles, 'Nodist', 'bin') : undefined),
    ...fnmRoots.flatMap((root) => [
      path.join(root, 'aliases', 'default', 'node.exe'),
      path.join(root, 'aliases', 'default', 'bin', 'node.exe'),
      ...installedNodeVersionCandidates(
        path.join(root, 'node-versions'),
        (version) => path.join(root, 'node-versions', version, 'installation', 'node.exe')
      ),
      ...installedNodeVersionCandidates(
        path.join(root, 'node-versions'),
        (version) => path.join(root, 'node-versions', version, 'installation', 'bin', 'node.exe')
      ),
    ]),
    ...(nvmHome
      ? installedNodeVersionCandidates(
          nvmHome,
          (version) => path.join(nvmHome, version, 'node.exe')
        )
      : []),
  ];
}

function nodeBinaryCandidates(userEnv?: Record<string, string>): string[] {
  const candidates =
    process.platform === 'win32'
      ? windowsNodeBinaryCandidates(userEnv)
      : posixNodeBinaryCandidates(userEnv);
  const seen = new Set<string>();

  return candidates.filter((candidate): candidate is string => {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return existsSync(candidate);
  });
}

async function probeNodeBinary(
  binary: string,
  env: NodeJS.ProcessEnv
): Promise<NodeDetectResult | null> {
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], {
      env,
      // A hung PATH shim (rustup-style proxy, corporate wrapper) must not
      // wedge the detect IPC promise forever. Matches the LSP launchers'
      // 5s probe convention.
      timeout: NODE_DETECT_TIMEOUT_MS,
    });
    return {
      installed: true,
      binary,
      version: stdout.trim(),
    };
  } catch {
    return null;
  }
}

function envWithNodeBinary(env: NodeJS.ProcessEnv, binary: string): NodeJS.ProcessEnv {
  if (!path.isAbsolute(binary)) return env;
  const nodeDir = path.dirname(binary);
  const currentPath = env.PATH ?? '';
  const pathParts = currentPath.split(path.delimiter).filter(Boolean);
  if (pathParts.includes(nodeDir)) return env;
  return {
    ...env,
    PATH: [nodeDir, ...pathParts].join(path.delimiter),
  };
}

/**
 * Probe the local `node` binary. Result cached per main-process
 * lifetime so each Run does not re-spawn the detector. Cache
 * invalidates when the renderer opens Settings → Native
 * Toolchains (the renderer calls `detect()` with a `force` flag —
 * see fold B in `nodeRunner.ts`).
 */
export async function detectNode(
  userEnv?: Record<string, string>,
  force = false
): Promise<NodeDetectResult> {
  const cacheable = userEnv === undefined;
  if (cacheable && !force && cachedDetect) return cachedDetect;
  const env = resolveNodeRunEnv(userEnv);
  let result = await probeNodeBinary('node', env);

  if (!result) {
    for (const candidate of nodeBinaryCandidates(userEnv)) {
      result = await probeNodeBinary(candidate, env);
      if (result) break;
    }
  }

  if (!result) {
    result = {
      installed: false,
      error: 'Node.js is not installed. Install it from https://nodejs.org',
    };
  }
  if (cacheable) cachedDetect = result;
  return result;
}

export function resolveNodeRunEnv(
  userEnv?: Record<string, string>
): NodeJS.ProcessEnv {
  return buildNativeRunnerEnv(combinedAllowlist(NODE_TOOLCHAIN_KEYS), userEnv);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function normalizeNativeMessages(value: unknown): NativeRunnerMessages | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(typeof value.stdoutTruncated === 'string'
      ? { stdoutTruncated: value.stdoutTruncated }
      : {}),
    ...(typeof value.stderrTruncated === 'string'
      ? { stderrTruncated: value.stderrTruncated }
      : {}),
  };
}

function normalizeRunId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return undefined;
  return trimmed;
}

function normalizeNodeRunOptions(value: unknown): NodeRunOptions {
  if (!isRecord(value)) return {};
  return {
    runId: normalizeRunId(value.runId),
    timeoutMs:
      typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    filePath: typeof value.filePath === 'string' ? value.filePath : undefined,
    userEnv: normalizeStringMap(value.userEnv),
    stdin: typeof value.stdin === 'string' ? value.stdin : undefined,
    messages: normalizeNativeMessages(value.messages),
  };
}

function invalidNodeRunResult(message: string): NodeRunResult {
  return {
    kind: 'error',
    stdout: '',
    stderr: message,
    exitCode: -1,
    executionTime: 0,
    error: message,
    timeoutMs: DEFAULT_NODE_TIMEOUT_MS,
  };
}

/**
 * RL-019 Slice 2 fold F — pick the subprocess cwd. Walks from the
 * saved tab's directory looking for a `node_modules` neighbor; if
 * found, that directory is the cwd so `require('lodash')` resolves
 * naturally. Falls back to `path.dirname(filePath)` for saved
 * tabs and `app.getPath('temp')` for unsaved Scratchpad tabs.
 */
export function resolveNodeCwd(filePath?: string): string {
  if (filePath) {
    const startDir = path.dirname(filePath);
    let dir = startDir;
    for (let depth = 0; depth < 8; depth += 1) {
      if (existsSync(path.join(dir, 'node_modules'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return startDir;
  }
  return app.getPath('temp');
}

/**
 * RL-019 Slice 2 fold G — pick the source input type (CommonJS vs
 * ESM). Saved extension wins for the explicit Node suffixes
 * (`.mjs` / `.mts` / `.cjs` / `.cts`), then we sniff the inline
 * source for syntax that cannot run in CommonJS, then fall back to
 * the nearest `package.json#type`. ESM uses `--input-type=module`
 * so static imports, `import.meta`, and top-level await work from a
 * Scratchpad tab without asking users to add a package.json.
 */
type NodeInputType = 'commonjs' | 'module';

function inputTypeFromFileExtension(filePath?: string): NodeInputType | null {
  if (!filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mjs' || ext === '.mts') return 'module';
  if (ext === '.cjs' || ext === '.cts') return 'commonjs';
  return null;
}

function packageTypeFromNearestPackageJson(startDir: string): NodeInputType | null {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const raw = readFileSync(pkgPath, 'utf-8');
        const json = JSON.parse(raw) as { type?: unknown };
        if (json.type === 'module') return 'module';
        if (json.type === 'commonjs') return 'commonjs';
      } catch {
        // Malformed package.json — keep walking so a parent package can still
        // provide a valid declaration; otherwise fall back below.
      }
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function isAcornNode(value: unknown): value is AcornNode {
  return isRecord(value) && typeof value.type === 'string';
}

function isFunctionScope(node: AcornNode): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

function nodeContainsModuleOnlyExpression(node: AcornNode): boolean {
  if (node.type === 'AwaitExpression') return true;
  if (node.type === 'MetaProperty') {
    const meta = (node as AcornNode & { meta?: { name?: unknown } }).meta;
    const property = (node as AcornNode & { property?: { name?: unknown } }).property;
    if (meta?.name === 'import' && property?.name === 'meta') return true;
  }
  if (isFunctionScope(node)) return false;

  for (const value of Object.values(node as unknown as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      if (value.some((entry) => isAcornNode(entry) && nodeContainsModuleOnlyExpression(entry))) {
        return true;
      }
    } else if (isAcornNode(value) && nodeContainsModuleOnlyExpression(value)) {
      return true;
    }
  }
  return false;
}

function sourceRequiresModuleInput(source: string): boolean {
  try {
    const program = parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'module',
    }) as AcornProgram;
    return program.body.some((statement) => {
      if (
        statement.type === 'ImportDeclaration' ||
        statement.type === 'ExportAllDeclaration' ||
        statement.type === 'ExportDefaultDeclaration' ||
        statement.type === 'ExportNamedDeclaration'
      ) {
        return true;
      }
      return nodeContainsModuleOnlyExpression(statement);
    });
  } catch {
    // If Acorn cannot parse the source (incomplete code, TS syntax before the
    // renderer transpiles, etc.), do not guess module mode. Node will surface
    // the real syntax/runtime error from the selected fallback mode.
    return false;
  }
}

function sourceLooksCommonJs(source: string): boolean {
  return /\b(?:require\s*\(|module\.exports\b|exports\.\w+\b|__dirname\b|__filename\b)/.test(
    source
  );
}

function pickInputType(
  cwd: string,
  source: string,
  filePath?: string
): NodeInputType {
  const extensionInputType = inputTypeFromFileExtension(filePath);
  if (extensionInputType) return extensionInputType;
  if (sourceRequiresModuleInput(source)) return 'module';
  if (sourceLooksCommonJs(source)) return 'commonjs';
  const packageStartDir = filePath ? path.dirname(filePath) : cwd;
  return packageTypeFromNearestPackageJson(packageStartDir) ?? 'commonjs';
}

async function spawnNode(
  source: string,
  options: NodeRunOptions,
  nodeBinary = 'node'
): Promise<NodeRunResult> {
  const timeoutMs = clampTimeout(options.timeoutMs);
  const cwd = resolveNodeCwd(options.filePath);
  const inputType = pickInputType(cwd, source, options.filePath);
  const env = envWithNodeBinary(resolveNodeRunEnv(options.userEnv), nodeBinary);
  const markers = truncationMarkers(options.messages);

  // Decide between inline `-e` invocation and temp-file fallback.
  // Both paths use `spawn` — no shell, no string interpolation.
  let args: string[];
  let cleanupTempDir: string | null = null;
  if (Buffer.byteLength(source, 'utf-8') <= NODE_INLINE_CODE_MAX_BYTES) {
    args = [`--input-type=${inputType}`, '-e', source];
  } else {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'lingua-node-'));
    const ext = inputType === 'module' ? 'mjs' : 'cjs';
    const tempFile = path.join(tempDir, `entry.${ext}`);
    await writeFile(tempFile, source, 'utf-8');
    args = [tempFile];
    cleanupTempDir = tempDir;
  }

  return await new Promise<NodeRunResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let resolved = false;
    let kind: NodeRunKind = 'success';
    let killedByTimer = false;
    let stoppedByUser = false;
    let escalationTimer: NodeJS.Timeout | null = null;

    const child = childProc.spawn(nodeBinary, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Process-group leader on POSIX so timeout/Stop can fell the whole
      // tree (user code that forks/spawns) via killProcessTree, not just
      // the direct child. See src/main/runners/processTree.ts.
      ...detachedSpawnOptions(),
    });

    const terminateChild = (nextKind: 'timeout' | 'stopped') => {
      if (resolved) return;
      if (nextKind === 'timeout') {
        killedByTimer = true;
      } else {
        stoppedByUser = true;
      }
      kind = nextKind;
      killProcessTree(child, 'SIGTERM');
      if (escalationTimer === null) {
        escalationTimer = setTimeout(() => {
          killProcessTree(child, 'SIGKILL');
        }, KILL_ESCALATION_DELAY_MS);
      }
    };

    if (options.runId) {
      activeNodeRuns.set(options.runId, () => terminateChild('stopped'));
    }

    // Stdin: Slice 6 forwarding. Empty / undefined closes
    // immediately so user code that reads stdin without an end
    // handler hits EOF on first read.
    //
    // The write/end below is wrapped in try/catch for the SYNCHRONOUS
    // already-destroyed case, but an EPIPE from a child that exits while
    // the buffer flushes is delivered ASYNCHRONOUSLY as a stream 'error'
    // event — without this listener it becomes an uncaught exception that
    // crashes the main process. Mirrors formatters.ts. Best-effort stdin:
    // the child not reading it is a normal outcome, never an error.
    child.stdin.on('error', () => {
      // EPIPE / ERR_STREAM_DESTROYED — child exited before consuming stdin.
    });
    try {
      if (options.stdin && options.stdin.length > 0) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    } catch {
      // stdin may already be closed if the child crashed during boot —
      // safe to ignore.
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      stdout += chunk.toString();
      if (stdout.length > MAX_NATIVE_STDERR_BYTES) {
        stdout = truncateBytes(
          stdout,
          MAX_NATIVE_STDERR_BYTES,
          markers.stdout
        );
        stdoutTruncated = true;
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderr += chunk.toString();
      if (stderr.length > MAX_NATIVE_STDERR_BYTES) {
        stderr = truncateBytes(
          stderr,
          MAX_NATIVE_STDERR_BYTES,
          markers.stderr
        );
        stderrTruncated = true;
      }
    });

    // Parent-owned timeout. Mirrors RL-078's pattern for the worker
    // runners — main owns the kill timer; the worker / subprocess
    // never schedules its own.
    const killTimer: NodeJS.Timeout = setTimeout(() => {
      terminateChild('timeout');
    }, timeoutMs);

    const finish = async (result: NodeRunResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      if (options.runId) activeNodeRuns.delete(options.runId);
      if (cleanupTempDir) {
        await rm(cleanupTempDir, { recursive: true, force: true }).catch(() => {});
      }
      resolve(result);
    };

    child.on('close', (code: number | null) => {
      const exitCode = code ?? -1;
      const executionTime = Date.now() - start;
      // Determine kind. The timer-kill path wins (kind already set
      // to 'timeout' above). The user-stop path wins as well. A
      // non-zero exit without either kill path is a runtime error.
      if (!killedByTimer && !stoppedByUser && exitCode !== 0) {
        kind = 'error';
      }
      const errorText =
        kind === 'timeout'
          ? `Run timed out after ${Math.round(timeoutMs / 1000)}s`
          : kind === 'error'
            ? stderr || `Process exited with code ${exitCode}`
            : undefined;
      void finish({
        kind,
        stdout,
        stderr,
        exitCode,
        executionTime,
        error: errorText,
        timeoutMs,
      });
    });

    child.on('error', (err: Error) => {
      // `error` fires on spawn failure (e.g. ENOENT when `node` is
      // not on PATH). We surface this as `missing-binary` so the
      // renderer can render the right copy. The detector usually
      // catches this earlier, but the race window can produce a
      // detector cache hit followed by a `node` removal — defense
      // in depth.
      const executionTime = Date.now() - start;
      const message = err.message || 'Failed to spawn node';
      const missing: NodeRunKind =
        /ENOENT/.test(message) || /not found/i.test(message) ? 'missing-binary' : 'error';
      void finish({
        kind: missing,
        stdout,
        stderr: stderr || message,
        exitCode: -1,
        executionTime,
        error: message,
        timeoutMs,
      });
    });
  });
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return DEFAULT_NODE_TIMEOUT_MS;
  }
  if (timeoutMs < 100) return 100;
  // Hard ceiling matches the runtimeTimeoutPresets `extended` (5 min).
  if (timeoutMs > 5 * 60 * 1000) return 5 * 60 * 1000;
  return Math.floor(timeoutMs);
}

async function runNodeCode(
  source: string,
  options: NodeRunOptions
): Promise<NodeRunResult> {
  const detect = await detectNode(options.userEnv);
  if (!detect.installed) {
    return {
      kind: 'missing-binary',
      stdout: '',
      stderr: detect.error ?? 'Node.js is not installed.',
      exitCode: -1,
      executionTime: 0,
      error: detect.error,
      timeoutMs: clampTimeout(options.timeoutMs),
    };
  }
  return spawnNode(source, options, detect.binary ?? 'node');
}

export function stopNodeRun(runId: unknown): { stopped: boolean } {
  const normalizedRunId = normalizeRunId(runId);
  if (!normalizedRunId) return { stopped: false };
  const stop = activeNodeRuns.get(normalizedRunId);
  if (!stop) return { stopped: false };
  stop();
  return { stopped: true };
}

/** Register all Node-related IPC handlers. */
export function registerNodeJSHandlers(): void {
  typedHandle(
    'node:detect',
    async (_event, userEnv?: unknown, force?: unknown) =>
      detectNode(normalizeStringMap(userEnv), force === true)
  );
  typedHandle(
    'node:run',
    async (_event, source: unknown, options?: unknown) => {
      if (typeof source !== 'string') {
        return invalidNodeRunResult('Node runner received invalid source.');
      }
      return runNodeCode(source, normalizeNodeRunOptions(options));
    }
  );
  typedHandle(
    'node:stop',
    async (_event, runId?: unknown) =>
      stopNodeRun(runId)
  );
}

/**
 * Test-only: reset the detection cache. Imported by
 * `tests/main/node-runner.test.ts`.
 */
export function __resetNodeDetectCache(): void {
  cachedDetect = null;
  activeNodeRuns.clear();
}
