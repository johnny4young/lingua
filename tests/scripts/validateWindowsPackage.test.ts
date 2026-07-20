import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateWindowsPackage } from '../../scripts/lib/windowsPackageValidation.mjs';

const roots: string[] = [];

async function createFixture(
  options: { installer?: string; latestInstaller?: string; blockmap?: boolean } = {}
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-win-package-'));
  roots.push(root);
  const installer = options.installer ?? 'Lingua-0.14.0-win-x64.exe';
  const latestInstaller = options.latestInstaller ?? installer;
  await mkdir(path.join(root, 'win-unpacked', 'resources'), { recursive: true });
  await writeFile(path.join(root, installer), 'installer');
  if (options.blockmap !== false) await writeFile(path.join(root, `${installer}.blockmap`), 'map');
  await writeFile(
    path.join(root, 'latest.yml'),
    `version: 0.14.0\nfiles:\n  - url: ${latestInstaller}\npath: ${latestInstaller}\n`
  );
  await writeFile(path.join(root, 'win-unpacked', 'lingua.exe'), 'binary');
  await writeFile(path.join(root, 'win-unpacked', 'resources', 'app.asar'), 'asar');
  await writeFile(
    path.join(root, 'win-unpacked', 'resources', 'app-update.yml'),
    'provider: github\nowner: johnny4young\nrepo: lingua\n'
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('validateWindowsPackage', () => {
  it('accepts one NSIS installer with its update metadata and unpacked app', async () => {
    const result = await validateWindowsPackage(await createFixture());
    expect(result).toMatchObject({
      installer: 'Lingua-0.14.0-win-x64.exe',
      updateManifest: 'latest.yml',
      updateProvider: 'github:johnny4young/lingua',
    });
  });

  it('does not count win-unpacked/lingua.exe as a second installer', async () => {
    const result = await validateWindowsPackage(await createFixture());
    expect(result.executable).toBe('win-unpacked/lingua.exe');
  });

  it('rejects a latest.yml that points at another installer', async () => {
    await expect(
      validateWindowsPackage(await createFixture({ latestInstaller: 'Lingua-other.exe' }))
    ).rejects.toThrow(/does not reference/u);
  });

  it('rejects a package without the differential-update blockmap', async () => {
    await expect(validateWindowsPackage(await createFixture({ blockmap: false }))).rejects.toThrow(
      /blockmap/u
    );
  });

  it('rejects an unpacked app without its asar payload', async () => {
    const root = await createFixture();
    await unlink(path.join(root, 'win-unpacked', 'resources', 'app.asar'));

    await expect(validateWindowsPackage(root)).rejects.toThrow(/resources\/app\.asar/u);
  });

  it('rejects updater metadata that targets a different GitHub repository', async () => {
    const root = await createFixture();
    await writeFile(
      path.join(root, 'win-unpacked', 'resources', 'app-update.yml'),
      'provider: github\nowner: someone-else\nrepo: lingua\n'
    );

    await expect(validateWindowsPackage(root)).rejects.toThrow(/johnny4young\/lingua/u);
  });

  it('rejects zero or multiple top-level installers', async () => {
    const emptyRoot = await createFixture();
    await unlink(path.join(emptyRoot, 'Lingua-0.14.0-win-x64.exe'));
    await expect(validateWindowsPackage(emptyRoot)).rejects.toThrow(/found 0/u);

    const multipleRoot = await createFixture();
    await writeFile(path.join(multipleRoot, 'Lingua-0.14.0-windows-x64.exe'), 'other');
    await expect(validateWindowsPackage(multipleRoot)).rejects.toThrow(/found 2/u);
  });

  it('rejects an installer that does not identify the supported x64 target', async () => {
    await expect(
      validateWindowsPackage(await createFixture({ installer: 'Lingua-0.14.0.exe' }))
    ).rejects.toThrow(/x64 NSIS installer/u);
  });
});
