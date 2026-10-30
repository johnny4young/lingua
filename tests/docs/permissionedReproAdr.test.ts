/** Keeps PERMISSIONED_REPRO_ADR.md in step with the shared contract it describes. */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildReproEnvelope } from '../../src/shared/reproEnvelope';
import { DEFAULT_REPRO_REQUEST } from '../../src/shared/reproPolicy';
import { parseReproReceipt } from '../../src/shared/reproReceipt';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

const ROOT = resolve(__dirname, '../..');
const adr = readFileSync(resolve(ROOT, 'docs/PERMISSIONED_REPRO_ADR.md'), 'utf-8');

describe('PERMISSIONED_REPRO_ADR.md', () => {
  it('points at modules that exist', () => {
    const paths = [...adr.matchAll(/`(src\/[^`]+\.ts)`/gu)].map(match => match[1]!);

    expect(paths).toEqual(
      expect.arrayContaining([
        'src/shared/reproEnvelope.ts',
        'src/shared/reproPolicy.ts',
        'src/shared/reproReceipt.ts',
      ])
    );
    for (const path of paths) expect(existsSync(resolve(ROOT, path)), path).toBe(true);
  });

  it('names the artifact kinds the code writes', async () => {
    const built = await buildReproEnvelope({
      capsule: FIXTURE_MINIMAL_JS,
      entry: 'main.mjs',
      runtime: { name: 'node', major: 24 },
      files: [],
      request: DEFAULT_REPRO_REQUEST,
    });

    expect(built.ok && built.value.kind).toBe('lingua-repro-envelope');
    expect(adr).toContain('`lingua-repro-envelope` v1');
    expect(parseReproReceipt('{"kind":"lingua-repro-receipt","version":2}')).toMatchObject({
      reason: 'unsupported-version',
    });
    expect(adr).toContain('`lingua-repro-receipt` v1');
  });

  it('documents every overall verdict and compliance value', () => {
    for (const value of [
      'refused',
      'fail',
      'incomplete',
      'pass',
      'clean',
      'violated',
      'not-observed',
    ]) {
      expect(adr).toContain(`\`${value}\``);
    }
  });

  it('rules out the fallbacks the threat model forbids', () => {
    expect(adr).toMatch(
      /no fallback to an unsandboxed run, a wider\s+policy or a permissive audit mode/iu
    );
    expect(adr).toMatch(/`network`\s*\|\s*`deny` only/u);
  });
});
