import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupNativeRunTempDir,
  disposeNativeRunTempDirs,
  stageNativeRunTempDir,
} from '../../src/main/runners/nativeRunTempDirs';

describe('native run staging during shutdown', () => {
  const untracked: string[] = [];

  afterEach(() => {
    disposeNativeRunTempDirs();
    for (const dir of untracked.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('removes staged user source synchronously without touching unrelated temp paths', () => {
    const staged = stageNativeRunTempDir('lingua-node-');
    const neighbor = mkdtempSync(path.join(tmpdir(), 'lingua-untracked-'));
    untracked.push(neighbor);
    writeFileSync(path.join(staged, 'entry.mjs'), 'private source');
    writeFileSync(path.join(neighbor, 'keep.txt'), 'unrelated');

    disposeNativeRunTempDirs();

    expect(existsSync(staged)).toBe(false);
    expect(existsSync(path.join(neighbor, 'keep.txt'))).toBe(true);
  });

  it('allows ordinary cleanup and repeated shutdown without deleting a later directory', async () => {
    const first = stageNativeRunTempDir('lingua-ruby-');
    await cleanupNativeRunTempDir(first);
    expect(existsSync(first)).toBe(false);

    const later = stageNativeRunTempDir('lingua-go-');
    disposeNativeRunTempDirs();
    disposeNativeRunTempDirs();
    expect(existsSync(later)).toBe(false);
  });
});
