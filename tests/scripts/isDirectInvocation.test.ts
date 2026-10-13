import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDirectInvocation } from '../../scripts/lib/isDirectInvocation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const helperRelative = path.join('scripts', 'lib', 'isDirectInvocation.mjs');
const helperUrl = pathToFileURL(path.join(repoRoot, helperRelative)).href;

describe('isDirectInvocation', () => {
  let tempRoot: string;
  // A space forces percent-encoding, and os.tmpdir() is itself behind a symlink on macOS.
  let linkedRepo: string;

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-direct-invocation-'));
    linkedRepo = path.join(tempRoot, 'linked repo');
    await symlink(repoRoot, linkedRepo, 'junction');
  });

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('matches the module through its real path and through a symlinked path', () => {
    expect(isDirectInvocation(helperUrl, path.join(repoRoot, helperRelative))).toBe(true);
    expect(isDirectInvocation(helperUrl, path.join(linkedRepo, helperRelative))).toBe(true);
  });

  it('returns false for a missing, unresolvable or different entry path', () => {
    expect(isDirectInvocation(helperUrl, undefined)).toBe(false);
    expect(isDirectInvocation(helperUrl, '')).toBe(false);
    expect(isDirectInvocation(helperUrl, path.join(tempRoot, 'missing.mjs'))).toBe(false);
    expect(isDirectInvocation(helperUrl, path.join(repoRoot, 'scripts', 'lib', 'cli-args.mjs'))).toBe(
      false
    );
  });

  it('still runs a gate invoked through a symlinked path, so a bad flag fails', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(linkedRepo, 'scripts', 'assert-prod-audit.mjs'), '--bogus-flag'],
      { encoding: 'utf8', timeout: 30_000 }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option '--bogus-flag'");
  });
});
