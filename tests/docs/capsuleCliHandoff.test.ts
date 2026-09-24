import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplayCapsuleCommand, runValidateCapsuleCommand } from '../../src/cli/commands/capsule';
import { CLI_EXIT_CODES } from '../../src/cli/exit-codes';
import { tryDecodeCapsuleJson } from '../../src/renderer/utils/importCapsule';
import { computeContentHash } from '../../src/shared/runCapsule';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';
import { createFakeIo } from '../cli/io-fake';

const examplePath = path.resolve('docs/examples/deterministic-run.capsule.json');

describe('documented capsule to CLI handoff', () => {
  it('ships a byte-stable RunCapsuleV1 that imports and validates without executing', async () => {
    const source = readFileSync(examplePath, 'utf8');
    expect(JSON.parse(source)).toEqual(FIXTURE_MINIMAL_JS);
    const decoded = tryDecodeCapsuleJson(source);
    expect(decoded.ok).toBe(true);
    expect(await computeContentHash(FIXTURE_MINIMAL_JS.source.content))
      .toBe(FIXTURE_MINIMAL_JS.source.contentHash);

    const { io, state } = createFakeIo({ files: { [examplePath]: source } });
    const exit = await runValidateCapsuleCommand(
      { filePath: examplePath, json: true, quiet: false }, io
    );
    expect(exit).toBe(CLI_EXIT_CODES.ok);
    expect(JSON.parse(state.stdout)).toMatchObject({ ok: true });
  });

  it('replays the trusted example deterministically only on the separate replay path', async () => {
    const source = readFileSync(examplePath, 'utf8');
    const { io, state } = createFakeIo({ files: { [examplePath]: source } });
    const exit = await runReplayCapsuleCommand(
      { filePath: examplePath, env: [], json: true, quiet: false }, io
    );
    expect(exit).toBe(CLI_EXIT_CODES.ok);
    const result = JSON.parse(state.stdout) as {
      comparison: { matches: boolean };
      run: { stdout: string };
    };
    expect(result.comparison.matches).toBe(true);
    expect(result.run.stdout).toBe('3\n');
  });

  it('rejects altered source before replay can execute it', async () => {
    const original = JSON.parse(readFileSync(examplePath, 'utf8')) as typeof FIXTURE_MINIMAL_JS;
    const altered = JSON.stringify({
      ...original,
      source: { ...original.source, content: 'console.log("must-not-run")' },
    });
    const { io, state } = createFakeIo({ files: { [examplePath]: altered } });
    const exit = await runReplayCapsuleCommand(
      { filePath: examplePath, env: [], json: true, quiet: false }, io
    );
    expect(exit).toBe(CLI_EXIT_CODES.userInputError);
    expect(JSON.parse(state.stdout)).toMatchObject({ reason: 'content-hash-mismatch' });
    expect(state.stdout).not.toContain('must-not-run');
  });
});
