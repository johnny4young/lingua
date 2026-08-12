// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { executeCliPlan, type CliExecutionPlan } from '../../../src/cli/runtime/execution';

function nodePlan(source: string): CliExecutionPlan {
  return {
    displayTarget: 'inline-test',
    runtime: 'node',
    cwd: process.cwd(),
    steps: [
      {
        command: process.execPath,
        args: ['-e', source],
        kind: 'execute',
      },
    ],
  };
}

describe('CLI subprocess execution', () => {
  it('forwards stdin and an explicit environment without a shell', async () => {
    const result = await executeCliPlan(
      nodePlan(
        'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => console.log(`${process.env.MODE}:${s}`));'
      ),
      { stdin: 'hello', timeoutMs: 2_000, env: { PATH: process.env.PATH, MODE: 'test' } }
    );
    expect(result).toMatchObject({
      status: 'success',
      exitCode: 0,
      stdout: 'test:hello\n',
      stderr: '',
    });
  });

  it('classifies non-zero exits as runtime errors', async () => {
    const result = await executeCliPlan(nodePlan('console.error("boom"); process.exit(7)'), {
      timeoutMs: 2_000,
      env: { PATH: process.env.PATH },
    });
    expect(result).toMatchObject({
      status: 'error',
      reason: 'non-zero-exit',
      exitCode: 7,
      stderr: 'boom\n',
    });
  });

  it('owns the timeout and terminates a hanging process', async () => {
    const result = await executeCliPlan(nodePlan('setInterval(() => {}, 1000)'), {
      timeoutMs: 100,
      env: { PATH: process.env.PATH },
    });
    expect(result.status).toBe('timeout');
    expect(result.reason).toBe('timeout');
    expect(result.durationMs).toBeLessThan(2_000);
  });

  it('classifies a missing binary as an unsupported runtime', async () => {
    const result = await executeCliPlan(
      {
        displayTarget: 'missing-runtime',
        runtime: 'missing',
        cwd: process.cwd(),
        steps: [
          {
            command: 'lingua-runtime-that-does-not-exist',
            args: [],
            kind: 'execute',
          },
        ],
      },
      { timeoutMs: 1_000, env: { PATH: process.env.PATH } }
    );
    expect(result).toMatchObject({
      status: 'error',
      reason: 'missing-runtime',
      exitCode: null,
      recovery: {
        executable: 'lingua-runtime-that-does-not-exist',
        installGuide: expect.stringContaining('linguacode.dev'),
      },
    });
  });

  it('caps runaway output and marks truncation without killing the program', async () => {
    let streamed = '';
    const result = await executeCliPlan(nodePlan('process.stdout.write("x".repeat(1_200_000))'), {
      timeoutMs: 2_000,
      env: { PATH: process.env.PATH },
      onStdout: chunk => {
        streamed += chunk;
      },
    });
    expect(result.status).toBe('success');
    expect(result.stdout).toContain('[output truncated by Lingua CLI]');
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
    expect(streamed).toBe(result.stdout);
  });

  it('streams output before a long-running process exits', async () => {
    let resolveFirstChunk: ((value: string) => void) | undefined;
    const firstChunk = new Promise<string>(resolve => {
      resolveFirstChunk = resolve;
    });
    const execution = executeCliPlan(
      nodePlan('console.log("ready"); setTimeout(() => console.log("done"), 150)'),
      {
        timeoutMs: 2_000,
        env: { PATH: process.env.PATH },
        onStdout: chunk => resolveFirstChunk?.(chunk),
      }
    );

    await expect(firstChunk).resolves.toBe('ready\n');
    await expect(execution).resolves.toMatchObject({
      status: 'success',
      stdout: 'ready\ndone\n',
    });
  });
});
