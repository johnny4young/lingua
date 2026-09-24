import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { validateLinuxPackage } from '../../scripts/lib/linuxPackageValidation.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
  version: string;
  productName: string;
};
const execFileAsync = promisify(execFile);
const installer = `${pkg.productName}-${pkg.version}-linux-x64.AppImage`;
const image = Buffer.alloc(64, 0);
image.set([0x7f, 0x45, 0x4c, 0x46], 0);
image.set([0x41, 0x49, 0x02], 8);

async function withFixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-linux-package-'));
  const file = path.join(root, installer);
  const sha512 = createHash('sha512').update(image).digest('base64');
  try {
    await writeFile(file, image);
    await chmod(file, 0o755);
    await writeFile(
      path.join(root, 'latest-linux.yml'),
      `version: ${pkg.version}\nfiles:\n  - url: ${installer}\n    sha512: ${sha512}\n    size: ${image.length}\n`
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('Linux AppImage release artifacts', () => {
  it('accepts a type-2 AppImage whose modern files[] manifest matches its bytes', async () => {
    await withFixture(async root => {
      await expect(validateLinuxPackage(root)).resolves.toMatchObject({
        installer,
        updateManifest: 'latest-linux.yml',
        version: pkg.version,
      });
    });
  });

  it('rejects an AppImage altered after the updater manifest was written', async () => {
    await withFixture(async root => {
      const altered = Buffer.from(image);
      altered[20] = 1;
      await writeFile(path.join(root, installer), altered);
      await expect(validateLinuxPackage(root)).rejects.toThrow(/sha512 mismatch/i);
    });
  });

  it('rejects a manifest pointing at a different public artifact', async () => {
    await withFixture(async root => {
      const manifest = path.join(root, 'latest-linux.yml');
      await writeFile(
        manifest,
        (await readFile(manifest, 'utf8')).replace(installer, 'Other.AppImage')
      );
      await expect(validateLinuxPackage(root)).rejects.toThrow(/does not reference/i);
    });
  });

  it('rejects an incorrect updater size even when the digest matches', async () => {
    await withFixture(async root => {
      const manifest = path.join(root, 'latest-linux.yml');
      await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('size: 64', 'size: 65'));
      await expect(validateLinuxPackage(root)).rejects.toThrow(/size mismatch/i);
    });
  });

  it('rejects a manifest for another version', async () => {
    await withFixture(async root => {
      const manifest = path.join(root, 'latest-linux.yml');
      await writeFile(
        manifest,
        (await readFile(manifest, 'utf8')).replace(`version: ${pkg.version}`, 'version: 0.0.0')
      );
      await expect(validateLinuxPackage(root)).rejects.toThrow(/version mismatch/i);
    });
  });

  it('rejects an artifact name that does not match the configured build pattern', async () => {
    await withFixture(async root => {
      const unexpected = `${pkg.productName}-${pkg.version}-linux-debug-linux-x64.AppImage`;
      await rename(path.join(root, installer), path.join(root, unexpected));
      const manifest = path.join(root, 'latest-linux.yml');
      await writeFile(manifest, (await readFile(manifest, 'utf8')).replace(installer, unexpected));
      await expect(validateLinuxPackage(root)).rejects.toThrow(/name\/version mismatch/i);
    });
  });

  it('rejects a renamed non-AppImage payload even with matching digest', async () => {
    await withFixture(async root => {
      const fake = Buffer.from(image);
      fake[8] = 0;
      await writeFile(path.join(root, installer), fake);
      const manifest = path.join(root, 'latest-linux.yml');
      await writeFile(
        manifest,
        (await readFile(manifest, 'utf8')).replace(
          /sha512: .+/u,
          `sha512: ${createHash('sha512').update(fake).digest('base64')}`
        )
      );
      await expect(validateLinuxPackage(root)).rejects.toThrow(/AppImage type 2/i);
    });
  });

  it('rejects multiple candidates and absent manifest', async () => {
    await withFixture(async root => {
      await writeFile(path.join(root, 'extra.AppImage'), image);
      await expect(validateLinuxPackage(root)).rejects.toThrow(/exactly one/i);
      await rm(path.join(root, 'extra.AppImage'));
      await rm(path.join(root, 'latest-linux.yml'));
      await expect(validateLinuxPackage(root)).rejects.toThrow(/latest-linux.yml/i);
    });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects an AppImage without executable mode',
    async () => {
      await withFixture(async root => {
        await chmod(path.join(root, installer), 0o644);
        await expect(validateLinuxPackage(root)).rejects.toThrow(/executable/i);
      });
    }
  );

  it('wires validation before Linux artifact upload', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8');
    const build = workflow.indexOf('- name: Build Linux AppImage');
    const verify = workflow.indexOf('node scripts/validate-linux-package.mjs --root out-builder');
    const upload = workflow.indexOf('- name: Upload Linux artifacts');
    expect(build).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(build);
    expect(upload).toBeGreaterThan(verify);
  });

  it('makes the release CLI fail closed on a stale manifest', async () => {
    await withFixture(async root => {
      const script = 'scripts/validate-linux-package.mjs';
      const good = await execFileAsync(process.execPath, [script, '--root', root]);
      expect(good.stdout).toContain('linux-package: valid');
      await writeFile(path.join(root, installer), Buffer.from(image).fill(1, 20, 21));
      await expect(execFileAsync(process.execPath, [script, '--root', root])).rejects.toMatchObject(
        {
          code: 1,
        }
      );
    });
  });
});
