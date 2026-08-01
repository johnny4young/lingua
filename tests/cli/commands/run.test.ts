// SPDX-License-Identifier: MIT

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runTargetCommand } from '../../../src/cli/commands/run';
import { CLI_EXIT_CODES } from '../../../src/cli/exit-codes';
import { createFakeIo } from '../io-fake';

const roots: string[] = [];

async function writeScript(source: string, extension = 'js'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-cli-run-'));
  roots.push(root);
  const file = path.join(root, `script.${extension}`);
  await writeFile(file, source, 'utf8');
  return file;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('lingua run command', () => {
  it('executes a source file with stdin, args, and explicit environment', async () => {
    const script = await writeScript(
      'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => console.log(`${process.env.MODE}:${process.argv[2]}:${s}`));'
    );
    const { io, state } = createFakeIo({ stdin: 'payload' });
    const code = await runTargetCommand(
      {
        target: script,
        timeoutMs: 2_000,
        env: [{ key: 'MODE', value: 'ci' }],
        programArgs: ['Lingua'],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toBe('ci:Lingua:payload\n');
    expect(state.stderr).toBe('');
  });

  it('emits one machine-readable JSON body', async () => {
    const script = await writeScript('console.log("json-run")');
    const { io, state } = createFakeIo();
    const code = await runTargetCommand(
      {
        target: script,
        env: [],
        programArgs: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: true,
      run: {
        status: 'success',
        runtime: 'node',
        stdout: 'json-run\n',
      },
    });
    expect(state.stderr).toBe('');
  });

  it('maps missing and unsupported targets to stable preflight exits', async () => {
    const missing = createFakeIo();
    expect(
      await runTargetCommand(
        {
          target: '/definitely/not/a/lingua-target',
          env: [],
          programArgs: [],
          json: false,
          quiet: false,
        },
        missing.io
      )
    ).toBe(CLI_EXIT_CODES.userInputError);
    expect(missing.state.stderr).toContain('target-not-found');

    const text = await writeScript('not executable', 'txt');
    const unsupported = createFakeIo();
    expect(
      await runTargetCommand(
        {
          target: text,
          env: [],
          programArgs: [],
          json: false,
          quiet: false,
        },
        unsupported.io
      )
    ).toBe(CLI_EXIT_CODES.unsupportedCapability);
    expect(unsupported.state.stderr).toContain('unsupported-file-type');
  });

  it('refuses loader-injection environment variables before execution', async () => {
    const script = await writeScript('console.log("must-not-run")');
    const { io, state } = createFakeIo();
    const code = await runTargetCommand(
      {
        target: script,
        env: [{ key: 'NODE_OPTIONS', value: '--require=./inject.cjs' }],
        programArgs: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: false,
      reason: 'blocked-environment-variable',
    });
  });
});
