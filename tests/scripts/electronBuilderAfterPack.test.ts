import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM build script without type declarations
import afterPack from '../../scripts/electron-builder-after-pack.mjs';

let appOutDir: string;
const context = (platform: string, arch = 3) => ({
  electronPlatformName: platform,
  arch,
  appOutDir,
  packager: { appInfo: { productFilename: 'Lingua' } },
});

beforeEach(async () => {
  appOutDir = await mkdtemp(path.join(os.tmpdir(), 'lingua-after-pack-'));
});

afterEach(async () => {
  await rm(appOutDir, { recursive: true, force: true });
});

describe('electron-builder afterPack', () => {
  it('leaves other platforms alone', async () => {
    await expect(afterPack(context('linux', 1))).resolves.toBeUndefined();
  });

  it('fails a macOS build whose app lost the DuckDB binding', async () => {
    await expect(afterPack(context('darwin', 3))).rejects.toThrow(
      /DuckDB binding missing from the packaged app: .*Lingua\.app\/Contents\/Resources\/app\.asar\.unpacked\/node_modules\/@duckdb\/node-bindings-darwin-arm64\/libduckdb\.dylib/
    );
  });

  it('refuses an architecture it cannot thin to', async () => {
    await expect(afterPack(context('darwin', 4))).rejects.toThrow(/No lipo architecture for electron-builder arch 4/);
  });
});
