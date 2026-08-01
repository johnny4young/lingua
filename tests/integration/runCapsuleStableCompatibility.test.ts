import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_RUN_CAPSULE_VERSION,
  computeContentHash,
  parseRunCapsule,
} from '../../src/shared/runCapsule';
import { tryDecodeCapsuleJson } from '../../src/renderer/utils/importCapsule';
import { runReplayCapsuleCommand, runValidateCapsuleCommand } from '../../src/cli/commands/capsule';
import { CLI_EXIT_CODES } from '../../src/cli/exit-codes';
import { createFakeIo } from '../cli/io-fake';

const FIXTURE_PATH = path.join(
  process.cwd(),
  'tests/fixtures/capsules/v0.15.0/javascript-input-set.capsule.json'
);
const FIXTURE_SHA256 = '2940533a9acdf88db8bf33d9363983d70d798a9ef306aca00d7f3b8e5be5d40f';
const FIXTURE_FILE = '/fixtures/v0.15.0/javascript-input-set.capsule.json';
const rawFixture = readFileSync(FIXTURE_PATH, 'utf8');

describe('Run Capsule stable-release compatibility journey', () => {
  it('pins the immutable v0.15.0 artifact bytes and provenance', () => {
    expect(createHash('sha256').update(rawFixture).digest('hex')).toBe(FIXTURE_SHA256);

    const raw = JSON.parse(rawFixture) as {
      version: number;
      appVersion: string;
      createdAt: string;
    };
    expect(raw).toMatchObject({
      version: 1,
      appVersion: '0.15.0',
      createdAt: '2026-07-28T21:09:05.000Z',
    });
    expect(raw.version).toBeLessThanOrEqual(CURRENT_RUN_CAPSULE_VERSION);
  });

  it('upgrades the stable artifact through the current shared parser without losing semantics', async () => {
    const parsed = parseRunCapsule(rawFixture);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      version: CURRENT_RUN_CAPSULE_VERSION,
      appVersion: '0.15.0',
      tab: {
        name: 'stable-input.js',
        language: 'javascript',
        runtimeMode: 'node',
      },
      input: {
        stdin: 'legacy capsule\n',
        setName: 'Stable 0.15 fixture',
        args: ['Ada'],
      },
      result: {
        status: 'success',
        stdout: 'Hello Ada: legacy capsule\n',
        stderr: '',
      },
    });
    expect(await computeContentHash(parsed.value.source.content)).toBe(
      parsed.value.source.contentHash
    );
  });

  it('decodes the stable artifact through the renderer import boundary', () => {
    const decoded = tryDecodeCapsuleJson(rawFixture);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.capsule.version).toBe(CURRENT_RUN_CAPSULE_VERSION);
    expect(decoded.capsule.appVersion).toBe('0.15.0');
    expect(decoded.capsule.input).toEqual({
      stdin: 'legacy capsule\n',
      setName: 'Stable 0.15 fixture',
      args: ['Ada'],
    });
    expect(decoded.byteLength).toBe(Buffer.byteLength(rawFixture.trim(), 'utf8'));
  });

  it('validates and replays the stable artifact through the current CLI boundary', async () => {
    const validation = createFakeIo({ files: { [FIXTURE_FILE]: rawFixture } });
    const validationExit = await runValidateCapsuleCommand(
      {
        filePath: FIXTURE_FILE,
        json: true,
        quiet: false,
      },
      validation.io
    );

    expect(validationExit).toBe(CLI_EXIT_CODES.ok);
    expect(JSON.parse(validation.state.stdout)).toMatchObject({
      ok: true,
      summary: expect.stringContaining('javascript · success'),
    });

    const replay = createFakeIo({ files: { [FIXTURE_FILE]: rawFixture } });
    const replayExit = await runReplayCapsuleCommand(
      {
        filePath: FIXTURE_FILE,
        timeoutMs: 2_000,
        env: [],
        json: true,
        quiet: false,
      },
      replay.io
    );

    expect(replayExit).toBe(CLI_EXIT_CODES.ok);
    expect(JSON.parse(replay.state.stdout)).toMatchObject({
      ok: true,
      command: 'capsule-replay',
      capsuleId: '01500000-0000-4000-8000-000000000001',
      recordedStatus: 'success',
      comparison: {
        matches: true,
        status: true,
        stdout: true,
        stderr: true,
      },
      run: {
        status: 'success',
        stdout: 'Hello Ada: legacy capsule\n',
        stderr: '',
      },
    });
  });
});
