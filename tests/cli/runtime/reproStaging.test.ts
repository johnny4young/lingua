import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ReproStagingError,
  disposeReproStaging,
  stageReproEnvelope,
} from '../../../src/cli/runtime/reproStaging';
import { buildReproEnvelope, type ReproEnvelopeV1 } from '../../../src/shared/reproEnvelope';
import { DEFAULT_REPRO_REQUEST } from '../../../src/shared/reproPolicy';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';

const HELPER = 'export const sum = (a, b) => a + b;\n';

async function envelope(): Promise<ReproEnvelopeV1> {
  const built = await buildReproEnvelope({
    capsule: FIXTURE_MINIMAL_JS,
    entry: 'main.mjs',
    runtime: { name: 'node', major: 24 },
    files: [{ path: 'lib/deep/sum.mjs', language: 'javascript', content: HELPER }],
    request: DEFAULT_REPRO_REQUEST,
  });
  if (!built.ok) throw new Error(`fixture envelope rejected: ${built.reason}`);
  return built.value;
}

describe('stageReproEnvelope', () => {
  let parent: string;
  beforeEach(async () => {
    parent = await mkdtemp(path.join(os.tmpdir(), 'repro-staging-test-'));
  });
  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('writes the entry and every file into private inputs with empty scratch and output', async () => {
    const staging = await stageReproEnvelope(await envelope(), parent);

    expect(await readFile(staging.entry, 'utf8')).toBe(FIXTURE_MINIMAL_JS.source.content);
    expect(await readFile(path.join(staging.inputs, 'lib', 'deep', 'sum.mjs'), 'utf8')).toBe(
      HELPER
    );
    expect(await readdir(staging.scratch)).toEqual([]);
    expect(await readdir(staging.output)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'keeps the root owner-only and the staged inputs read-only',
    async () => {
      const staging = await stageReproEnvelope(await envelope(), parent);

      expect((await stat(staging.root)).mode & 0o777).toBe(0o700);
      expect((await stat(staging.entry)).mode & 0o777).toBe(0o444);
    }
  );

  it('refuses an envelope whose stored hash does not describe its bytes', async () => {
    const valid = await envelope();
    const tampered: ReproEnvelopeV1 = {
      ...valid,
      files: [{ ...valid.files[0]!, content: 'export const sum = () => 0;\n' }],
    };

    await expect(stageReproEnvelope(tampered, parent)).rejects.toMatchObject({
      reason: 'staged-hash-mismatch',
      message: 'lib/deep/sum.mjs changed while staging.',
    });
    await expect(stageReproEnvelope(tampered, parent)).rejects.toBeInstanceOf(ReproStagingError);
  });

  it('removes the whole root, read-only inputs included', async () => {
    const staging = await stageReproEnvelope(await envelope(), parent);

    await disposeReproStaging(staging);

    expect(await readdir(parent)).toEqual([]);
  });
});
