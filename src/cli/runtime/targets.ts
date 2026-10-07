// SPDX-License-Identifier: MIT
/** Resolve source files, conventional project roots, and Capsule source into execution plans. */

import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isSea } from 'node:sea';

import { sourceRequiresModuleInput } from '../../shared/nodeSourceMode';
import {
  pythonCommandCandidates,
  resolvePythonInterpreter,
} from '../../shared/python/interpreter';
import type { CliExecutionPlan, CliExecutionStep } from './execution';

export type ExecutionTargetReason =
  | 'target-not-found'
  | 'target-read-failed'
  | 'unsupported-file-type'
  | 'unsupported-language'
  | 'unsupported-runtime-mode'
  | 'invalid-project-manifest'
  | 'no-project-entry';

export class ExecutionTargetError extends Error {
  constructor(
    readonly reason: ExecutionTargetReason,
    message: string
  ) {
    super(message);
    this.name = 'ExecutionTargetError';
  }
}

export async function resolveExecutionTarget(
  target: string,
  programArgs: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env
): Promise<CliExecutionPlan> {
  const absolute = path.resolve(target);
  let targetStat;
  try {
    targetStat = await stat(absolute);
  } catch (error) {
    const code = errnoCode(error);
    throw new ExecutionTargetError(
      code === 'ENOENT' ? 'target-not-found' : 'target-read-failed',
      code === 'ENOENT'
        ? `Target was not found: ${target}`
        : `Could not inspect target ${target}: ${errorMessage(error)}`
    );
  }

  if (targetStat.isFile()) {
    return planFile(absolute, target, programArgs, env);
  }
  if (targetStat.isDirectory()) {
    return planProject(absolute, target, programArgs, env);
  }
  throw new ExecutionTargetError(
    'unsupported-file-type',
    `Target must be a regular file or directory: ${target}`
  );
}

export async function resolveCapsuleSource(
  input: {
    language: string;
    runtimeMode: string;
    source: string;
    capsuleId: string;
  },
  programArgs: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env
): Promise<CliExecutionPlan> {
  if (input.runtimeMode === 'browser-preview') {
    throw new ExecutionTargetError(
      'unsupported-runtime-mode',
      'Browser-preview Capsules require a DOM and cannot replay in the headless CLI.'
    );
  }

  const displayTarget = `capsule:${input.capsuleId}`;
  const cwd = process.cwd();
  switch (input.language) {
    case 'javascript': {
      return planJavaScriptCapsule(displayTarget, cwd, input, programArgs, false);
    }
    case 'typescript': {
      return planJavaScriptCapsule(displayTarget, cwd, input, programArgs, true);
    }
    case 'python':
      return planScriptSource(
        { displayTarget, runtime: 'python', cwd, command: await findPython(cwd, env) },
        input.source,
        programArgs,
        { inline: source => ['-c', source], filename: 'main.py' }
      );
    case 'ruby':
      return planScriptSource(
        { displayTarget, runtime: 'ruby', cwd, command: commandName('ruby') },
        input.source,
        programArgs,
        { inline: source => ['-e', source, '--'], filename: 'main.rb' }
      );
    case 'lua':
      // `lua -e src arg` would load `arg` as a script, so argv needs a staged file.
      return planScriptSource(
        { displayTarget, runtime: 'lua', cwd, command: commandName('lua') },
        input.source,
        programArgs,
        { inline: programArgs.length === 0 ? source => ['-e', source] : null, filename: 'main.lua' }
      );
    case 'go':
      return stageCompiledSource(displayTarget, 'go', 'main.go', input.source, programArgs);
    case 'rust':
      return stageCompiledSource(displayTarget, 'rust', 'main.rs', input.source, programArgs);
    default:
      throw new ExecutionTargetError(
        'unsupported-language',
        `Capsule language ${JSON.stringify(input.language)} is not executable by the CLI.`
      );
  }
}

async function planProject(
  root: string,
  displayTarget: string,
  programArgs: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv
): Promise<CliExecutionPlan> {
  const packageJson = path.join(root, 'package.json');
  if (await exists(packageJson)) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(packageJson, 'utf8'));
    } catch (error) {
      throw new ExecutionTargetError(
        'invalid-project-manifest',
        `Could not parse ${packageJson}: ${errorMessage(error)}`
      );
    }
    const scripts = isRecord(manifest) && isRecord(manifest.scripts) ? manifest.scripts : {};
    const script =
      typeof scripts.start === 'string' ? 'start' : typeof scripts.dev === 'string' ? 'dev' : null;
    if (script) {
      const npm = await npmScriptCommand(script, programArgs, env);
      return {
        displayTarget,
        runtime: `npm:${script}`,
        cwd: root,
        steps: [{ ...npm, kind: 'execute' }],
      };
    }
    if (isRecord(manifest) && typeof manifest.main === 'string') {
      const mainPath = path.resolve(root, manifest.main);
      if (await isFile(mainPath)) return planFile(mainPath, displayTarget, programArgs, env);
    }
  }

  if (await exists(path.join(root, 'go.mod'))) {
    return singleStep(displayTarget, 'go-project', root, commandName('go'), [
      'run',
      '.',
      ...programArgs,
    ]);
  }
  if (await exists(path.join(root, 'Cargo.toml'))) {
    return singleStep(displayTarget, 'cargo', root, commandName('cargo'), [
      'run',
      '--quiet',
      '--',
      ...programArgs,
    ]);
  }

  for (const candidate of PROJECT_ENTRY_CANDIDATES) {
    const entry = path.join(root, candidate);
    if (await isFile(entry)) return planFile(entry, displayTarget, programArgs, env);
  }

  throw new ExecutionTargetError(
    'no-project-entry',
    [
      `No executable project entry was found in ${displayTarget}.`,
      'Supported roots expose package.json scripts.start/scripts.dev, go.mod, Cargo.toml,',
      `or one conventional entry: ${PROJECT_ENTRY_CANDIDATES.join(', ')}.`,
      'Pass a specific source file when the project uses a framework-specific launcher.',
    ].join(' ')
  );
}

const PROJECT_ENTRY_CANDIDATES = [
  'main.py',
  'app.py',
  'explore.py',
  'src/main.py',
  'app/main.py',
  'main.rb',
  'app.rb',
  'index.js',
  'src/index.js',
  'index.ts',
  'src/index.ts',
] as const;

/** File extensions the CLI plans by language. */
export const CLI_SOURCE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  javascript: ['.js', '.mjs', '.cjs'],
  typescript: ['.ts', '.mts', '.cts'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  ruby: ['.rb'],
  lua: ['.lua'],
};

async function planFile(
  absolute: string,
  displayTarget: string,
  programArgs: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv
): Promise<CliExecutionPlan> {
  const cwd = path.dirname(absolute);
  const extension = path.extname(absolute).toLowerCase();
  const language = Object.keys(CLI_SOURCE_EXTENSIONS).find(key =>
    CLI_SOURCE_EXTENSIONS[key]!.includes(extension)
  );
  switch (language) {
    case 'javascript':
      return singleStep(displayTarget, 'node', cwd, nodeRuntimeExecutable(), [
        absolute,
        ...programArgs,
      ]);
    case 'typescript':
      return singleStep(displayTarget, 'node-typescript', cwd, nodeRuntimeExecutable(), [
        '--experimental-strip-types',
        absolute,
        ...programArgs,
      ]);
    case 'python':
      return singleStep(displayTarget, 'python', cwd, await findPython(cwd, env), [
        absolute,
        ...programArgs,
      ]);
    case 'go':
      return singleStep(displayTarget, 'go', cwd, commandName('go'), [
        'run',
        absolute,
        ...programArgs,
      ]);
    case 'ruby':
      return singleStep(displayTarget, 'ruby', cwd, commandName('ruby'), [
        absolute,
        ...programArgs,
      ]);
    case 'lua':
      return singleStep(displayTarget, 'lua', cwd, commandName('lua'), [absolute, ...programArgs]);
    case 'rust': {
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-cli-rust-'));
      const binary = path.join(
        temporaryRoot,
        process.platform === 'win32' ? 'program.exe' : 'program'
      );
      return {
        displayTarget,
        runtime: 'rust',
        cwd,
        cleanupPaths: [temporaryRoot],
        steps: [
          {
            command: commandName('rustc'),
            args: [absolute, '-o', binary],
            kind: 'prepare',
          },
          { command: binary, args: [...programArgs], kind: 'execute' },
        ],
      };
    }
    default:
      throw new ExecutionTargetError(
        'unsupported-file-type',
        `Unsupported source extension ${extension || '(none)'} for ${displayTarget}. Supported: .js, .mjs, .cjs, .ts, .mts, .cts, .py, .go, .rs, .rb, .lua.`
      );
  }
}

async function stageCompiledSource(
  displayTarget: string,
  language: 'go' | 'rust',
  filename: string,
  source: string,
  programArgs: ReadonlyArray<string>
): Promise<CliExecutionPlan> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `lingua-cli-${language}-`));
  const sourcePath = path.join(temporaryRoot, filename);
  await writeFile(sourcePath, source, 'utf8');
  if (language === 'go') {
    return {
      displayTarget,
      runtime: 'go',
      cwd: temporaryRoot,
      cleanupPaths: [temporaryRoot],
      steps: [
        {
          command: commandName('go'),
          args: ['run', sourcePath, ...programArgs],
          kind: 'execute',
        },
      ],
    };
  }
  const binary = path.join(temporaryRoot, process.platform === 'win32' ? 'program.exe' : 'program');
  return {
    displayTarget,
    runtime: 'rust',
    cwd: temporaryRoot,
    cleanupPaths: [temporaryRoot],
    steps: [
      { command: commandName('rustc'), args: [sourcePath, '-o', binary], kind: 'prepare' },
      { command: binary, args: [...programArgs], kind: 'execute' },
    ],
  };
}

function singleStep(
  displayTarget: string,
  runtime: string,
  cwd: string,
  command: string,
  args: string[]
): CliExecutionPlan {
  return {
    displayTarget,
    runtime,
    cwd,
    steps: [{ command, args, kind: 'execute' }],
  };
}

/**
 * Larger sources run from a staged file: a single argv entry is capped at
 * 128 KiB on Linux and a whole Windows command line at ~32K characters.
 */
export const INLINE_SOURCE_MAX_BYTES = process.platform === 'win32' ? 8 * 1024 : 64 * 1024;

/** Drops the staged entry path so a staged run sees the same argv as `node -e`. */
const NODE_ARGV_SHIM = 'process.argv.splice(1, 1);\n';

interface ScriptStepTarget {
  displayTarget: string;
  runtime: string;
  cwd: string;
  command: string;
}

async function planScriptSource(
  target: ScriptStepTarget,
  source: string,
  programArgs: ReadonlyArray<string>,
  options: {
    inline: ((source: string) => string[]) | null;
    filename: string;
    stagedArgs?: (entry: string, root: string) => string[];
    extraFiles?: Readonly<Record<string, string>>;
  }
): Promise<CliExecutionPlan> {
  const { displayTarget, runtime, cwd, command } = target;
  if (options.inline && Buffer.byteLength(source, 'utf8') <= INLINE_SOURCE_MAX_BYTES) {
    return singleStep(displayTarget, runtime, cwd, command, [
      ...options.inline(source),
      ...programArgs,
    ]);
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-cli-source-'));
  const entry = path.join(temporaryRoot, options.filename);
  try {
    await writeFile(entry, source, 'utf8');
    for (const [name, content] of Object.entries(options.extraFiles ?? {})) {
      await writeFile(path.join(temporaryRoot, name), content, 'utf8');
    }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    displayTarget,
    runtime,
    cwd,
    cleanupPaths: [temporaryRoot],
    steps: [
      {
        command,
        args: [...(options.stagedArgs?.(entry, temporaryRoot) ?? [entry]), ...programArgs],
        kind: 'execute',
      },
    ],
  };
}

function planJavaScriptCapsule(
  displayTarget: string,
  cwd: string,
  input: { runtimeMode: string; source: string },
  programArgs: ReadonlyArray<string>,
  typescript: boolean
): Promise<CliExecutionPlan> {
  const worker = input.runtimeMode === 'worker';
  if (worker || input.runtimeMode === 'node') {
    const source = worker
      ? [
          '(async () => {',
          input.source,
          '})().catch(error => {',
          '  console.error(error instanceof Error ? error.stack : String(error));',
          '  process.exitCode = 1;',
          '});',
        ].join('\n')
      : input.source;
    // Plain commonjs/module input types disable type stripping, and the JS
    // parser cannot classify annotated source, so Node detects TS node mode.
    const detectTypeScript = typescript && !worker;
    const module = !worker && !typescript && sourceRequiresModuleInput(input.source);
    const inputType = detectTypeScript
      ? []
      : [`--input-type=${module ? 'module' : 'commonjs'}${typescript ? '-typescript' : ''}`];
    const extension = detectTypeScript
      ? '.ts'
      : `.${module ? 'm' : 'c'}${typescript ? 'ts' : 'js'}`;
    const flags = typescript ? ['--experimental-strip-types'] : [];
    return planScriptSource(
      {
        displayTarget,
        runtime: `node${typescript ? '-typescript' : ''}${worker ? '-worker' : ''}`,
        cwd,
        command: nodeRuntimeExecutable(),
      },
      source,
      programArgs,
      {
        inline: inlineSource => [...flags, ...inputType, '-e', inlineSource, '--'],
        filename: `entry${extension}`,
        stagedArgs: (entry, root) => [
          ...flags,
          '--require',
          path.join(root, 'argv-shim.cjs'),
          entry,
        ],
        extraFiles: { 'argv-shim.cjs': NODE_ARGV_SHIM },
      }
    );
  }
  throw new ExecutionTargetError(
    'unsupported-runtime-mode',
    `Capsule runtime mode ${JSON.stringify(input.runtimeMode)} is not replayable by the CLI for ${typescript ? 'TypeScript' : 'JavaScript'}; supported modes are worker and node.`
  );
}

export { pythonCommandCandidates } from '../../shared/python/interpreter';

export function nodeRuntimeExecutable(options?: { sea?: boolean; execPath?: string }): string {
  const sea = options?.sea ?? isSea();
  return sea ? commandName('node') : (options?.execPath ?? process.execPath);
}

/**
 * Discovery must probe the SAME environment the child is spawned with
 * (`buildCliRuntimeEnvironment`), not the parent `process.env`: with
 * `--env PATH=...` the two diverge, and probing the parent can select a
 * launcher that is absent from the child PATH or skip one that is present.
 *
 * The candidate ORDER is the shared policy; the probe below is the CLI's own,
 * because only this surface resolves against the child environment.
 */
async function findPython(
  startDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string> {
  const resolved = await resolvePythonInterpreter(
    { startDirectory, platform, env, walkUp: true, respectPythonEnv: true },
    async candidate => {
      if (candidate.source === 'path') {
        return (await executableIsOnPath(candidate.command, platform, env))
          ? commandName(candidate.command)
          : null;
      }
      // An explicit PYTHON override is taken at its word, as before: the user
      // naming an interpreter outranks our ability to stat it.
      if (candidate.source === 'python-env') return candidate.command;
      return (await isFile(candidate.command)) ? candidate.command : null;
    }
  );
  // Nothing matched. Hand back the leading command name so the spawn fails
  // with a recognisable "python not found" instead of a null downstream.
  return resolved ?? commandName(pythonCommandCandidates(platform)[0]!);
}

async function executableIsOnPath(
  executable: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const pathValue = env.PATH ?? env.Path ?? env.path;
  if (!pathValue) return false;

  const windows = platform === 'win32';
  const pathApi = windows ? path.win32 : path.posix;
  const delimiter = windows ? ';' : ':';
  const extensions = windows
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)
        .map(extension => extension.toLowerCase())
    : [''];
  const hasExtension = pathApi.extname(executable).length > 0;

  for (const rawEntry of pathValue.split(delimiter)) {
    const entry = rawEntry.trim().replace(/^"|"$/gu, '');
    if (!entry) continue;
    const base = pathApi.join(entry, executable);
    const candidates =
      windows && !hasExtension ? extensions.map(extension => base + extension) : [base];
    for (const candidate of candidates) {
      if (await isExecutableFile(candidate, platform)) return true;
    }
  }
  return false;
}

function commandName(name: string): string {
  return process.platform === 'win32' && ['npm', 'npx'].includes(name) ? `${name}.cmd` : name;
}

// cmd.exe metacharacters, escaped the way cross-spawn does for `.cmd` shims.
const CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/gu;

function escapeCmdArgument(argument: string): string {
  const quoted = `"${argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`;
  // Twice: once for the cmd.exe /c line, once for the shim's own %* expansion.
  return quoted.replace(CMD_META_CHARACTERS, '^$1').replace(CMD_META_CHARACTERS, '^$1');
}

/**
 * Node refuses to spawn `.cmd` files without a shell (EINVAL), so Windows runs
 * npm.cmd through an absolute COMSPEC with every argument escaped. A launcher
 * that cannot be resolved stays `npm` so the spawn reports a missing runtime.
 */
export async function npmScriptCommand(
  script: string,
  programArgs: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  fileExists: (candidate: string) => Promise<boolean> = isFile
): Promise<Pick<CliExecutionStep, 'command' | 'args' | 'windowsVerbatimArguments'>> {
  const npmArgs = ['run', script, '--', ...programArgs];
  if (platform !== 'win32') return { command: 'npm', args: npmArgs };
  const comspec = env.COMSPEC ?? env.ComSpec;
  const npmCmd = await resolveAbsoluteOnPath('npm.cmd', env, fileExists);
  if (!comspec || !path.win32.isAbsolute(comspec) || !npmCmd) {
    return { command: 'npm', args: npmArgs };
  }
  const commandLine = [
    npmCmd.replace(CMD_META_CHARACTERS, '^$1'),
    ...npmArgs.map(escapeCmdArgument),
  ];
  return {
    command: comspec,
    args: ['/d', '/s', '/c', `"${commandLine.join(' ')}"`],
    windowsVerbatimArguments: true,
  };
}

/** Only fully-qualified PATH entries, so a project cwd cannot supply the launcher. */
async function resolveAbsoluteOnPath(
  executable: string,
  env: NodeJS.ProcessEnv,
  fileExists: (candidate: string) => Promise<boolean>
): Promise<string | null> {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? '';
  for (const rawEntry of pathValue.split(';')) {
    const entry = rawEntry.trim().replace(/^"|"$/gu, '');
    if (!path.win32.isAbsolute(entry)) continue;
    const candidate = path.win32.join(entry, executable);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function isExecutableFile(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  if (!(await isFile(filePath))) return false;
  if (platform === 'win32') return true;
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
