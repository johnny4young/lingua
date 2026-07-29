import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertProductionReactBundle,
  forceProductionNodeEnv,
} from '../../scripts/lib/productionBuild.mjs';
import packageJson from '../../package.json';

const temporaryDirectories: string[] = [];

async function createAssetsDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-production-build-'));
  temporaryDirectories.push(root);
  const assetsDir = path.join(root, 'assets');
  await mkdir(assetsDir);
  return assetsDir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('production build environment', () => {
  it('overrides an inherited development NODE_ENV', () => {
    const env = { NODE_ENV: 'development' };

    forceProductionNodeEnv(env);

    expect(env.NODE_ENV).toBe('production');
  });

  it('keeps the canonical web build behind the production wrapper', () => {
    expect(packageJson.scripts['build:web']).toBe('node ./scripts/build-web.mjs');
  });

  it('accepts production renderer artifacts', async () => {
    const assetsDir = await createAssetsDir();
    await writeFile(path.join(assetsDir, 'index-production.js'), 'const mode = "production";');
    await writeFile(path.join(assetsDir, 'react-production.js'), 'export const version = 19;');

    await expect(assertProductionReactBundle(assetsDir)).resolves.toBeUndefined();
  });

  it('rejects React development diagnostics in renderer artifacts', async () => {
    const assetsDir = await createAssetsDir();
    await writeFile(
      path.join(assetsDir, 'renamed-vendor-chunk.js'),
      'console.info("Download the React DevTools for a better development experience");'
    );

    await expect(assertProductionReactBundle(assetsDir)).rejects.toThrow(
      /contains React development code/u
    );
  });
});
