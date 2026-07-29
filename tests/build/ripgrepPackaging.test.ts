import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyRipgrepBinaries } from '../../scripts/copy-ripgrep-binaries.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const builderConfigPath = path.join(repoRoot, 'electron-builder.yml');
const bundleScriptPath = path.join(repoRoot, 'scripts', 'build-desktop-bundles.mjs');

let temporaryRoot: string | null = null;

afterEach(async () => {
  if (!temporaryRoot) return;
  await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = null;
});

describe('ripgrep desktop packaging', () => {
  it('copies the platform executable into the stable native build path', async () => {
    temporaryRoot = await mkdtemp(path.join(process.cwd(), '.tmp-ripgrep-package-'));
    const sourcePath = path.join(temporaryRoot, 'source-rg');
    await writeFile(sourcePath, 'binary fixture', 'utf8');
    await chmod(sourcePath, 0o755);

    const target = { platform: process.platform, arch: process.arch };
    const [destinationPath] = await copyRipgrepBinaries({
      repoRoot: temporaryRoot,
      targets: [target],
      sourcePathForTarget: () => sourcePath,
    });

    expect(await readFile(destinationPath, 'utf8')).toBe('binary fixture');
    expect(destinationPath).toBe(
      path.join(
        temporaryRoot,
        '.vite',
        'native',
        'ripgrep',
        `${process.platform}-${process.arch}`,
        process.platform === 'win32' ? 'rg.exe' : 'rg'
      )
    );
    if (process.platform !== 'win32') {
      expect((await stat(destinationPath)).mode & 0o111).not.toBe(0);
    }
  });

  it('keeps the copy step and extraResource destination wired together', async () => {
    const [builderConfig, bundleScript] = await Promise.all([
      readFile(builderConfigPath, 'utf8'),
      readFile(bundleScriptPath, 'utf8'),
    ]);

    expect(bundleScript).toContain("from './copy-ripgrep-binaries.mjs'");
    expect(bundleScript).toContain('await copyRipgrepBinaries({ repoRoot })');
    expect(builderConfig).toContain(
      'from: .vite/native/ripgrep/${platform}-${arch}'
    );
    expect(builderConfig).toContain('to: ripgrep');
  });

  it('keeps both macOS architectures in the bundle build', async () => {
    const [copyScript, workspaceConfig] = await Promise.all([
      readFile(
        path.join(repoRoot, 'scripts', 'copy-ripgrep-binaries.mjs'),
        'utf8'
      ),
      readFile(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
    ]);

    expect(copyScript).toContain("{ platform: 'darwin', arch: 'arm64' }");
    expect(copyScript).toContain("{ platform: 'darwin', arch: 'x64' }");
    expect(workspaceConfig).toContain('supportedArchitectures:');
    expect(workspaceConfig).toMatch(/cpu:[\s\S]*- arm64[\s\S]*- x64/);
  });
});
