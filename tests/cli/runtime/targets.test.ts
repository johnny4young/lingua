// SPDX-License-Identifier: MIT

import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { executeCliPlan } from '../../../src/cli/runtime/execution';
import {
  ExecutionTargetError,
  INLINE_SOURCE_MAX_BYTES,
  nodeRuntimeExecutable,
  npmScriptCommand,
  pythonCommandCandidates,
  resolveCapsuleSource,
  resolveExecutionTarget,
} from '../../../src/cli/runtime/targets';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-cli-targets-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('CLI execution target resolution', () => {
  it('runs JavaScript files directly with Node and preserves passthrough args', async () => {
    const root = await tempRoot();
    const entry = path.join(root, 'hello.js');
    await writeFile(entry, 'console.log("hello")', 'utf8');
    const plan = await resolveExecutionTarget(entry, ['--name', 'Lingua']);
    expect(plan.runtime).toBe('node');
    expect(plan.cwd).toBe(root);
    expect(plan.steps).toEqual([
      {
        command: process.execPath,
        args: [entry, '--name', 'Lingua'],
        kind: 'execute',
      },
    ]);
  });

  it('uses a host Node executable instead of recursively spawning a standalone SEA', () => {
    expect(nodeRuntimeExecutable({ sea: false, execPath: '/opt/node/bin/node' })).toBe(
      '/opt/node/bin/node'
    );
    expect(nodeRuntimeExecutable({ sea: true, execPath: '/usr/local/bin/lingua' })).toBe('node');
  });

  it('uses platform-native Python command precedence', () => {
    expect(pythonCommandCandidates('darwin')).toEqual(['python3', 'python']);
    expect(pythonCommandCandidates('linux')).toEqual(['python3', 'python']);
    expect(pythonCommandCandidates('win32')).toEqual(['python', 'py', 'python3']);
  });

  it('falls back to an available platform Python command on PATH', async () => {
    const root = await tempRoot();
    const bin = path.join(root, 'bin');
    const entry = path.join(root, 'main.py');
    const launcher = process.platform === 'win32' ? 'python.exe' : 'python';
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, launcher), '', 'utf8');
    if (process.platform !== 'win32') await chmod(path.join(bin, launcher), 0o755);
    await writeFile(entry, 'print("hello")\n', 'utf8');

    const previousPath = process.env.PATH;
    const previousPython = process.env.PYTHON;
    process.env.PATH = bin;
    delete process.env.PYTHON;
    try {
      const plan = await resolveExecutionTarget(entry, []);
      expect(plan.steps[0]?.command).toBe('python');
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousPython === undefined) delete process.env.PYTHON;
      else process.env.PYTHON = previousPython;
    }
  });

  it('resolves the Python launcher against the environment the child will receive', async () => {
    const root = await tempRoot();
    const bin = path.join(root, 'bin');
    const entry = path.join(root, 'main.py');
    const launcher = process.platform === 'win32' ? 'python.exe' : 'python';
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, launcher), '', 'utf8');
    if (process.platform !== 'win32') await chmod(path.join(bin, launcher), 0o755);
    await writeFile(entry, 'print("hello")\n', 'utf8');

    // process.env is deliberately untouched: discovery must read the provided
    // child environment (--env PATH=...), which only offers `python`.
    const plan = await resolveExecutionTarget(entry, [], { PATH: bin });
    expect(plan.steps[0]?.command).toBe('python');

    const override = await resolveExecutionTarget(entry, [], {
      PATH: bin,
      PYTHON: path.join(bin, launcher),
    });
    expect(override.steps[0]?.command).toBe(path.join(bin, launcher));

    const capsule = await resolveCapsuleSource(
      { language: 'python', runtimeMode: 'worker', source: 'print(1)', capsuleId: 'cap-env' },
      [],
      { PATH: bin }
    );
    expect(capsule.steps[0]?.command).toBe('python');
  });

  it.skipIf(process.platform === 'win32')(
    'ignores a non-executable Python-looking file on a POSIX PATH',
    async () => {
      const root = await tempRoot();
      const bin = path.join(root, 'bin');
      const entry = path.join(root, 'main.py');
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(bin, 'python3'), '', 'utf8');
      await writeFile(path.join(bin, 'python'), '', 'utf8');
      await chmod(path.join(bin, 'python3'), 0o644);
      await chmod(path.join(bin, 'python'), 0o755);
      await writeFile(entry, 'print("hello")\n', 'utf8');

      const previousPath = process.env.PATH;
      const previousPython = process.env.PYTHON;
      process.env.PATH = bin;
      delete process.env.PYTHON;
      try {
        const plan = await resolveExecutionTarget(entry, []);
        expect(plan.steps[0]?.command).toBe('python');
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        if (previousPython === undefined) delete process.env.PYTHON;
        else process.env.PYTHON = previousPython;
      }
    }
  );

  it('prefers a package start script for a Node project root', async () => {
    const root = await tempRoot();
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { start: 'node src/index.js', dev: 'vite' } }),
      'utf8'
    );
    const plan = await resolveExecutionTarget(root, ['--port', '9000']);
    expect(plan.runtime).toBe('npm:start');
    expect(plan.steps[0]?.args).toEqual(['run', 'start', '--', '--port', '9000']);
  });

  it('recognizes Go and Cargo project roots without guessing an entry file', async () => {
    const goRoot = await tempRoot();
    await writeFile(path.join(goRoot, 'go.mod'), 'module example.test/hello\n', 'utf8');
    expect((await resolveExecutionTarget(goRoot, [])).runtime).toBe('go-project');

    const rustRoot = await tempRoot();
    await writeFile(path.join(rustRoot, 'Cargo.toml'), '[package]\nname="hello"\n', 'utf8');
    expect((await resolveExecutionTarget(rustRoot, [])).runtime).toBe('cargo');
  });

  it('uses a project-local Python virtual environment for conventional entries', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'main.py'), 'print("hello")\n', 'utf8');
    const python =
      process.platform === 'win32'
        ? path.join(root, '.venv', 'Scripts', 'python.exe')
        : path.join(root, '.venv', 'bin', 'python');
    await mkdir(path.dirname(python), { recursive: true });
    await writeFile(python, '', 'utf8');
    const plan = await resolveExecutionTarget(root, []);
    expect(plan.runtime).toBe('python');
    expect(plan.steps[0]?.command).toBe(python);
  });

  it('fails closed for unsupported files and roots without an executable entry', async () => {
    const root = await tempRoot();
    const text = path.join(root, 'README.txt');
    await writeFile(text, 'not executable', 'utf8');
    await expect(resolveExecutionTarget(text, [])).rejects.toMatchObject({
      reason: 'unsupported-file-type',
    });
    await rm(text);
    await expect(resolveExecutionTarget(root, [])).rejects.toBeInstanceOf(ExecutionTargetError);
  });

  it('rejects browser-preview replay and maps JavaScript Capsule source to Node', async () => {
    await expect(
      resolveCapsuleSource(
        {
          language: 'javascript',
          runtimeMode: 'browser-preview',
          source: 'document.body.textContent = "hello"',
          capsuleId: 'capsule-browser',
        },
        []
      )
    ).rejects.toMatchObject({ reason: 'unsupported-runtime-mode' });

    const plan = await resolveCapsuleSource(
      {
        language: 'javascript',
        runtimeMode: 'node',
        source: 'console.log(process.argv[1])',
        capsuleId: 'capsule-node',
      },
      ['Lingua']
    );
    expect(plan.runtime).toBe('node');
    expect(plan.steps[0]?.args).toContain('Lingua');
  });

  it('wraps worker Capsules so top-level await keeps worker semantics', async () => {
    const plan = await resolveCapsuleSource(
      {
        language: 'javascript',
        runtimeMode: 'worker',
        source: 'await Promise.resolve(); console.log("ready");',
        capsuleId: 'capsule-top-level-await',
      },
      []
    );
    expect(plan.runtime).toBe('node-worker');
    expect(plan.steps[0]?.args).toContain('--input-type=commonjs');
    expect(plan.steps[0]?.args.some(arg => arg.includes('await Promise.resolve()'))).toBe(true);
  });

  it('rejects alternate JavaScript runtimes instead of silently using Node', async () => {
    await expect(
      resolveCapsuleSource(
        {
          language: 'javascript',
          runtimeMode: 'deno',
          source: 'console.log(Deno.version)',
          capsuleId: 'capsule-deno',
        },
        []
      )
    ).rejects.toMatchObject({ reason: 'unsupported-runtime-mode' });
  });

  async function replay(
    language: string,
    runtimeMode: string,
    source: string,
    args: string[] = []
  ) {
    const plan = await resolveCapsuleSource(
      { language, runtimeMode, source, capsuleId: 'capsule-exec' },
      args
    );
    const result = await executeCliPlan(plan, {
      timeoutMs: 10_000,
      env: { PATH: process.env.PATH },
    });
    return { plan, result };
  }

  it.each([
    ['worker', 'const x: number = 1;\nconsole.log(x);'],
    ['node', 'const x: number = 1;\nconsole.log(x);'],
    [
      'node',
      'import process from "node:process";\nconst x: number = 1;\nprocess.stdout.write(`${x}\\n`);',
    ],
    ['node', 'const x: number = await Promise.resolve(1);\nconsole.log(x);'],
  ])('executes annotated TypeScript Capsules in %s mode', async (mode, source) => {
    const { result } = await replay('typescript', mode, source);
    expect(result).toMatchObject({ status: 'success', stdout: '1\n', stderr: '' });
  });

  it.each([
    ['javascript', 'worker'],
    ['javascript', 'node'],
    ['typescript', 'node'],
  ])(
    'forwards dash-leading argv to %s %s Capsules as program arguments',
    async (language, mode) => {
      const { result } = await replay(
        language,
        mode,
        'console.log(JSON.stringify(process.argv.slice(1)))',
        ['--flag', '-v']
      );
      expect(result).toMatchObject({ status: 'success', stdout: '["--flag","-v"]\n' });
    }
  );

  it.skipIf(spawnSync('ruby', ['-v']).status !== 0)(
    'forwards dash-leading argv to Ruby Capsules',
    async () => {
      const { result } = await replay('ruby', 'worker', 'p ARGV', ['--flag', 'v']);
      expect(result).toMatchObject({ status: 'success', stdout: '["--flag", "v"]\n' });
    }
  );

  it.each([
    ['javascript', 'worker', ''],
    ['javascript', 'node', ''],
    ['typescript', 'node', '\nexport {};'],
  ])(
    'stages a %s %s source above the argv limit and keeps the inline argv contract',
    async (language, mode, suffix) => {
      const padding = `// ${'x'.repeat(1_200_000)}\n`;
      const source = `${padding}console.log(JSON.stringify(process.argv.slice(1)));${suffix}`;
      expect(Buffer.byteLength(source)).toBeGreaterThan(INLINE_SOURCE_MAX_BYTES);
      const { plan, result } = await replay(language, mode, source, ['-a', 'b']);
      expect(plan.steps[0]?.args.every(arg => arg.length < 4096)).toBe(true);
      expect(result).toMatchObject({ status: 'success', stdout: '["-a","b"]\n' });
      for (const cleanup of plan.cleanupPaths ?? []) {
        await expect(access(cleanup)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    }
  );

  it('stages oversized Python Capsule source instead of passing it on argv', async () => {
    const plan = await resolveCapsuleSource(
      {
        language: 'python',
        runtimeMode: 'worker',
        source: `# ${'x'.repeat(INLINE_SOURCE_MAX_BYTES)}\nprint(1)`,
        capsuleId: 'capsule-large-python',
      },
      ['-x']
    );
    expect(plan.cleanupPaths).toHaveLength(1);
    expect(plan.steps[0]?.args).toEqual([path.join(plan.cleanupPaths![0]!, 'main.py'), '-x']);
    await rm(plan.cleanupPaths![0]!, { recursive: true, force: true });
  });

  it('runs npm scripts through an escaped absolute COMSPEC on Windows', async () => {
    const command = await npmScriptCommand(
      'start',
      ['--port', 'a b', 'x&calc', '50%'],
      { COMSPEC: 'C:\\Windows\\System32\\cmd.exe', PATH: 'relative;C:\\nodejs' },
      'win32',
      async candidate => candidate === 'C:\\nodejs\\npm.cmd'
    );
    expect(command).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '"C:\\nodejs\\npm.cmd ^^^"run^^^" ^^^"start^^^" ^^^"--^^^" ^^^"--port^^^" ^^^"a^^^ b^^^" ^^^"x^^^&calc^^^" ^^^"50^^^%^^^""',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it('leaves npm unresolved on Windows without a trusted COMSPEC or launcher', async () => {
    const env = { COMSPEC: 'cmd.exe', PATH: 'C:\\nodejs' };
    expect(await npmScriptCommand('dev', [], env, 'win32', async () => true)).toEqual({
      command: 'npm',
      args: ['run', 'dev', '--'],
    });
    expect(
      await npmScriptCommand(
        'dev',
        [],
        { ...env, COMSPEC: 'C:\\cmd.exe' },
        'win32',
        async () => false
      )
    ).toMatchObject({ command: 'npm' });
    expect(await npmScriptCommand('dev', ['-x'], {}, 'linux')).toEqual({
      command: 'npm',
      args: ['run', 'dev', '--', '-x'],
    });
  });
});
