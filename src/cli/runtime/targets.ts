// SPDX-License-Identifier: MIT
/** Resolve source files, conventional project roots, and Capsule source into execution plans. */

import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sourceRequiresModuleInput } from '../../shared/nodeSourceMode';
import type { CliExecutionPlan } from './execution';

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
  programArgs: ReadonlyArray<string>
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
    return planFile(absolute, target, programArgs);
  }
  if (targetStat.isDirectory()) {
    return planProject(absolute, target, programArgs);
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
  programArgs: ReadonlyArray<string>
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
      return singleStep(displayTarget, 'python', cwd, await findPython(cwd), [
        '-c',
        input.source,
        ...programArgs,
      ]);
    case 'ruby':
      return singleStep(displayTarget, 'ruby', cwd, commandName('ruby'), [
        '-e',
        input.source,
        ...programArgs,
      ]);
    case 'lua':
      return singleStep(displayTarget, 'lua', cwd, commandName('lua'), [
        '-e',
        input.source,
        ...programArgs,
      ]);
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
  programArgs: ReadonlyArray<string>
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
      return singleStep(displayTarget, `npm:${script}`, root, commandName('npm'), [
        'run',
        script,
        '--',
        ...programArgs,
      ]);
    }
    if (isRecord(manifest) && typeof manifest.main === 'string') {
      const mainPath = path.resolve(root, manifest.main);
      if (await isFile(mainPath)) return planFile(mainPath, displayTarget, programArgs);
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
    if (await isFile(entry)) return planFile(entry, displayTarget, programArgs);
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

async function planFile(
  absolute: string,
  displayTarget: string,
  programArgs: ReadonlyArray<string>
): Promise<CliExecutionPlan> {
  const cwd = path.dirname(absolute);
  const extension = path.extname(absolute).toLowerCase();
  switch (extension) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return singleStep(displayTarget, 'node', cwd, process.execPath, [absolute, ...programArgs]);
    case '.ts':
    case '.mts':
    case '.cts':
      return singleStep(displayTarget, 'node-typescript', cwd, process.execPath, [
        '--experimental-strip-types',
        absolute,
        ...programArgs,
      ]);
    case '.py':
      return singleStep(displayTarget, 'python', cwd, await findPython(cwd), [
        absolute,
        ...programArgs,
      ]);
    case '.go':
      return singleStep(displayTarget, 'go', cwd, commandName('go'), [
        'run',
        absolute,
        ...programArgs,
      ]);
    case '.rb':
      return singleStep(displayTarget, 'ruby', cwd, commandName('ruby'), [
        absolute,
        ...programArgs,
      ]);
    case '.lua':
      return singleStep(displayTarget, 'lua', cwd, commandName('lua'), [absolute, ...programArgs]);
    case '.rs': {
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

function planJavaScriptCapsule(
  displayTarget: string,
  cwd: string,
  input: { runtimeMode: string; source: string },
  programArgs: ReadonlyArray<string>,
  typescript: boolean
): CliExecutionPlan {
  if (input.runtimeMode === 'worker') {
    const wrappedSource = [
      '(async () => {',
      input.source,
      '})().catch(error => {',
      '  console.error(error instanceof Error ? error.stack : String(error));',
      '  process.exitCode = 1;',
      '});',
    ].join('\n');
    return singleStep(
      displayTarget,
      typescript ? 'node-typescript-worker' : 'node-worker',
      cwd,
      process.execPath,
      [
        ...(typescript ? ['--experimental-strip-types'] : []),
        '--input-type=commonjs',
        '-e',
        wrappedSource,
        ...programArgs,
      ]
    );
  }
  if (input.runtimeMode === 'node') {
    return singleStep(
      displayTarget,
      typescript ? 'node-typescript' : 'node',
      cwd,
      process.execPath,
      [
        ...(typescript ? ['--experimental-strip-types'] : []),
        `--input-type=${sourceRequiresModuleInput(input.source) ? 'module' : 'commonjs'}`,
        '-e',
        input.source,
        ...programArgs,
      ]
    );
  }
  throw new ExecutionTargetError(
    'unsupported-runtime-mode',
    `Capsule runtime mode ${JSON.stringify(input.runtimeMode)} is not replayable by the CLI for ${typescript ? 'TypeScript' : 'JavaScript'}; supported modes are worker and node.`
  );
}

async function findPython(startDirectory: string): Promise<string> {
  let current = startDirectory;
  while (true) {
    const local =
      process.platform === 'win32'
        ? path.join(current, '.venv', 'Scripts', 'python.exe')
        : path.join(current, '.venv', 'bin', 'python');
    if (await isFile(local)) return local;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.env.PYTHON || commandName('python3');
}

function commandName(name: string): string {
  return process.platform === 'win32' && ['npm', 'npx'].includes(name) ? `${name}.cmd` : name;
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
