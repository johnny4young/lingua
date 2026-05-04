import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts/run-desktop-smoke.mjs');

describe('scripts/run-desktop-smoke.mjs', () => {
  it('fails fast when --against-packaged is missing its path', () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--against-packaged'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--against-packaged requires a path');
  });

  it('fails fast when --against-packaged consumes another flag as its path', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--against-packaged', '--offline'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--against-packaged requires a path');
  });
});
