/**
 * RL-098 Slice 1 — capsule validate command tests.
 */

import { describe, expect, it } from 'vitest';
import { CLI_EXIT_CODES } from '../../../src/cli/exit-codes';
import { runValidateCapsuleCommand } from '../../../src/cli/commands/capsule';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import { MAX_CAPSULE_BYTES } from '../../../src/shared/runCapsule';
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
    const enoent = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
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

  it('rejects a wrong-version capsule', async () => {
    const bad = JSON.stringify({ ...FIXTURE_MINIMAL_JS, version: 2 });
    const { io, state } = createFakeIo({ files: { '/tmp/v2.json': bad } });
    const code = await runValidateCapsuleCommand(
      { filePath: '/tmp/v2.json', json: false, quiet: false },
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
