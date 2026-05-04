// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyRuntimeAssetFiles,
  resolveRuntimeAssetRequestPath,
} from '../../build/copyRuntimeAssetsPlugin.mts';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lingua-runtime-assets-'));
  tempDirs.push(tempDir);
  return tempDir;
}

describe('copyRuntimeAssetsPlugin helpers', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0).map((tempDir) =>
        rm(tempDir, { recursive: true, force: true })
      )
    );
  });

  it('resolves only valid dev-server asset paths under the source dir', () => {
    const sourceDir = path.join('/repo', 'node_modules', 'pyodide');
    const prefix = '/src/renderer/pyodide/';

    expect(
      resolveRuntimeAssetRequestPath(
        sourceDir,
        prefix,
        '/src/renderer/pyodide/pyodide.mjs?import'
      )
    ).toEqual({
      status: 'serve',
      absolutePath: path.join(sourceDir, 'pyodide.mjs'),
    });

    expect(
      resolveRuntimeAssetRequestPath(sourceDir, prefix, '/src/renderer/other/file.js')
    ).toEqual({ status: 'next' });
    expect(
      resolveRuntimeAssetRequestPath(
        sourceDir,
        prefix,
        '/src/renderer/pyodide/%2e%2e/package.json'
      )
    ).toEqual({ status: 'bad-request' });
    expect(
      resolveRuntimeAssetRequestPath(
        sourceDir,
        prefix,
        '/src/renderer/pyodide/..%5cpackage.json'
      )
    ).toEqual({ status: 'bad-request' });
    expect(
      resolveRuntimeAssetRequestPath(
        sourceDir,
        prefix,
        '/src/renderer/pyodide/%E0%A4%A'
      )
    ).toEqual({ status: 'bad-request' });
  });

  it('fails critical missing files but skips optional files', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = await createTempDir();
    const sourceDir = path.join(root, 'source');
    const targetDir = path.join(root, 'target');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'pyodide.mjs'), 'export {};\n', 'utf8');

    await copyRuntimeAssetFiles(
      sourceDir,
      targetDir,
      ['pyodide.mjs', 'ffi.d.ts'],
      ['pyodide.mjs']
    );

    await expect(readFile(path.join(targetDir, 'pyodide.mjs'), 'utf8')).resolves.toBe(
      'export {};\n'
    );
    await expect(
      copyRuntimeAssetFiles(
        sourceDir,
        path.join(root, 'missing-critical'),
        ['pyodide.asm.wasm'],
        ['pyodide.asm.wasm']
      )
    ).rejects.toThrow(/critical runtime asset pyodide\.asm\.wasm/u);
  });
});
