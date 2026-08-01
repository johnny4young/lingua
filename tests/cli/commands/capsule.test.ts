/**
 * implementation — capsule validate command tests.
 */

import { describe, expect, it } from 'vitest';
import { CLI_EXIT_CODES } from '../../../src/cli/exit-codes';
import {
  runReplayCapsuleCommand,
  runValidateCapsuleCommand,
} from '../../../src/cli/commands/capsule';
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_STOPPED,
  FIXTURE_TIMEOUT,
} from '../../shared/runCapsule.fixtures';
import { computeContentHash, MAX_CAPSULE_BYTES } from '../../../src/shared/runCapsule';
import { createFakeIo } from '../io-fake';

const VALID_JSON = JSON.stringify(FIXTURE_MINIMAL_JS);

describe('runValidateCapsuleCommand', () => {
  it('exits 0 on a valid capsule and prints the summary', async () => {
    const { io, state } = createFakeIo({ files: { '/tmp/run.json': VALID_JSON } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/run.json', json: false, quiet: false },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain(FIXTURE_MINIMAL_JS.tab.language);
    expect(state.stdout).toContain(FIXTURE_MINIMAL_JS.result.status);
  });

  it('--json shape on success', async () => {
    const { io, state } = createFakeIo({ files: { '/tmp/run.json': VALID_JSON } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/run.json', json: true, quiet: false },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    const parsed = JSON.parse(state.stdout) as { ok: boolean; summary: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toMatch(/\d+ms/);
  });

  it('maps ENOENT to user input error', async () => {
    const enoent = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
    enoent.code = 'ENOENT';
    const { io, state } = createFakeIo({ readFileError: enoent });
    const code = await runValidateCapsuleCommand(
      { filePath: '/missing.json', json: false, quiet: false },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('lingua capsule validate');
    expect(state.stderr).toContain('file-not-found');
  });

  it('rejects an oversized capsule', async () => {
    const big = JSON.stringify({
      ...FIXTURE_MINIMAL_JS,
      result: {
        ...FIXTURE_MINIMAL_JS.result,
        stdout: 'x'.repeat(MAX_CAPSULE_BYTES),
      },
    });
    const { io, state } = createFakeIo({ files: { '/tmp/oversized.json': big } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/oversized.json', json: false, quiet: false },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('oversized');
  });

  it('reports a capsule from a newer Lingua with its own reason', async () => {
    const bad = JSON.stringify({ ...FIXTURE_MINIMAL_JS, version: 2 });
    const { io, state } = createFakeIo({ files: { '/tmp/v2.json': bad } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/v2.json', json: false, quiet: false },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    // Scripts branch on this token, so it must distinguish a capsule this
    // build is too old to read from one that is genuinely malformed.
    expect(state.stderr).toContain('capsule-from-newer-app');
  });

  it('rejects a capsule with no usable version as unsupported-version', async () => {
    const bad = JSON.stringify({ ...FIXTURE_MINIMAL_JS, version: 'one' });
    const { io, state } = createFakeIo({ files: { '/tmp/vbad.json': bad } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/vbad.json', json: false, quiet: false },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('unsupported-version');
  });

  it('rejects malformed JSON', async () => {
    const { io, state } = createFakeIo({ files: { '/tmp/bad.json': '{ not json' } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/bad.json', json: false, quiet: false },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('invalid-json');
  });

  it('--json shape on failure carries reason + detail', async () => {
    const { io, state } = createFakeIo({ files: { '/tmp/bad.json': '{' } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/bad.json', json: true, quiet: false },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    const parsed = JSON.parse(state.stdout) as { ok: boolean; reason: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('invalid-json');
  });

  it('--quiet suppresses success summary but keeps exit code', async () => {
    const { io, state } = createFakeIo({ files: { '/tmp/run.json': VALID_JSON } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/run.json', json: false, quiet: true },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toBe('');
  });
});

describe('runReplayCapsuleCommand', () => {
  it('replays validated source and reports an exact recorded-output match', async () => {
    const { io, state } = createFakeIo({ files: { '/tmp/run.json': VALID_JSON } });
    const code = await runReplayCapsuleCommand(
      {
        filePath: '/tmp/run.json',
        timeoutMs: 2_000,
        env: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: true,
      command: 'capsule-replay',
      capsuleId: FIXTURE_MINIMAL_JS.capsuleId,
      recordedStatus: 'success',
      comparison: {
        matches: true,
        status: true,
        stdout: true,
        stderr: true,
      },
      run: { status: 'success', stdout: '3\n' },
    });
  });

  it('refuses to execute source whose recorded content hash no longer matches', async () => {
    const tampered = JSON.stringify({
      ...FIXTURE_MINIMAL_JS,
      source: {
        ...FIXTURE_MINIMAL_JS.source,
        content: 'console.log("tampered and must not run")',
      },
    });
    const { io, state } = createFakeIo({ files: { '/tmp/tampered.json': tampered } });
    const code = await runReplayCapsuleCommand(
      {
        filePath: '/tmp/tampered.json',
        env: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: false,
      reason: 'content-hash-mismatch',
    });
    expect(state.stdout).not.toContain('tampered and must not run');
  });

  it('replays recorded argv and stdin', async () => {
    const content =
      'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => console.log(`${process.argv[1]}:${s}`));';
    const capsule = {
      ...FIXTURE_MINIMAL_JS,
      source: { content, contentHash: await computeContentHash(content) },
      input: { stdin: 'payload', args: ['Lingua'] },
      result: { status: 'success' as const, durationMs: 1, stdout: 'Lingua:payload\n' },
    };
    const { io, state } = createFakeIo({
      files: { '/tmp/input.json': JSON.stringify(capsule) },
    });
    const code = await runReplayCapsuleCommand(
      {
        filePath: '/tmp/input.json',
        env: [],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toBe('Lingua:payload\n');
    expect(state.stderr).toContain('recorded output matches');
  });

  it('reports a successful replay whose output differs without hiding the delta', async () => {
    const content = 'console.log(4);';
    const capsule = {
      ...FIXTURE_MINIMAL_JS,
      source: { content, contentHash: await computeContentHash(content) },
    };
    const { io, state } = createFakeIo({
      files: { '/tmp/different.json': JSON.stringify(capsule) },
    });
    const code = await runReplayCapsuleCommand(
      {
        filePath: '/tmp/different.json',
        env: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: true,
      comparison: { matches: false, status: true, stdout: false, stderr: true },
      run: { stdout: '4\n' },
    });
  });

  it('rejects browser-preview Capsules as unsupported in a headless CLI', async () => {
    const capsule = {
      ...FIXTURE_MINIMAL_JS,
      tab: { ...FIXTURE_MINIMAL_JS.tab, runtimeMode: 'browser-preview' },
    };
    const { io, state } = createFakeIo({
      files: { '/tmp/browser.json': JSON.stringify(capsule) },
    });
    const code = await runReplayCapsuleCommand(
      {
        filePath: '/tmp/browser.json',
        env: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.unsupportedCapability);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: false,
      reason: 'unsupported-runtime-mode',
    });
  });

  it('reproduces and compares a recorded timeout with the runtime exit code', async () => {
    const { io, state } = createFakeIo({
      files: { '/tmp/timeout.json': JSON.stringify(FIXTURE_TIMEOUT) },
    });
    const code = await runReplayCapsuleCommand(
      {
        filePath: '/tmp/timeout.json',
        timeoutMs: 100,
        env: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.runtimeError);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: false,
      comparison: { matches: true, status: true, stdout: true, stderr: true },
      run: { status: 'timeout', reason: 'timeout' },
    });
  });

  it('accepts worker-style top-level await and bounds the replay', async () => {
    const { io, state } = createFakeIo({
      files: { '/tmp/stopped.json': JSON.stringify(FIXTURE_STOPPED) },
    });
    const code = await runReplayCapsuleCommand(
      {
        filePath: '/tmp/stopped.json',
        timeoutMs: 100,
        env: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.runtimeError);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: false,
      comparison: { matches: false, status: false },
      run: { status: 'timeout', reason: 'timeout' },
    });
  });
});
