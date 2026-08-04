import { describe, expect, it } from 'vitest';
import nodePath from 'node:path';

import {
  assertNpmPackContents,
  buildCliPackageManifest,
  buildSeaConfig,
  buildTarArchiveArgs,
  canBuildStandalone,
  cliArchiveName,
  cliBinaryName,
  CLI_PACKAGE_NAME,
  isDirectInvocation,
  main,
  resolveStandaloneTarget,
  SEA_SENTINEL_FUSE,
  SUPPORTED_STANDALONE_TARGETS,
} from '../../scripts/package-cli.mjs';

describe('CLI distribution packaging', () => {
  it('renders a minimal public package without inheriting the private desktop manifest', () => {
    expect(buildCliPackageManifest({ version: '1.2.3' })).toEqual({
      name: CLI_PACKAGE_NAME,
      version: '1.2.3',
      description: 'Headless offline CLI for Lingua utilities, local runners, and Run Capsules',
      license: 'SEE LICENSE IN LICENSE',
      homepage: 'https://linguacode.dev',
      repository: {
        type: 'git',
        url: 'https://github.com/johnny4young/lingua.git',
      },
      bugs: {
        url: 'https://github.com/johnny4young/lingua/issues',
      },
      keywords: ['lingua', 'cli', 'code-runner', 'developer-tools', 'offline'],
      bin: {
        lingua: 'bin/lingua.cjs',
      },
      files: ['bin', 'README.md', 'LICENSE'],
      engines: {
        node: '24.x',
      },
      publishConfig: {
        access: 'public',
      },
    });
  });

  it('keeps standalone targets explicit and release names deterministic', () => {
    expect(SUPPORTED_STANDALONE_TARGETS).toEqual(['linux-x64', 'windows-x64']);
    expect(resolveStandaloneTarget('linux', 'x64')).toBe('linux-x64');
    expect(resolveStandaloneTarget('win32', 'x64')).toBe('windows-x64');
    expect(() => resolveStandaloneTarget('darwin', 'arm64')).toThrow(/npm package/u);
    expect(canBuildStandalone('linux', 'x64')).toBe(true);
    expect(canBuildStandalone('darwin', 'arm64')).toBe(false);
    expect(cliBinaryName('linux')).toBe('lingua');
    expect(cliBinaryName('win32')).toBe('lingua.exe');
    expect(cliArchiveName('1.2.3', 'linux-x64')).toBe('lingua-cli-v1.2.3-linux-x64.tar.gz');
    expect(cliArchiveName('1.2.3', 'windows-x64')).toBe('lingua-cli-v1.2.3-windows-x64.tar.gz');
  });

  it('disables runtime argument injection in the single executable config', () => {
    expect(SEA_SENTINEL_FUSE).toBe('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2');
    expect(buildSeaConfig('/tmp/lingua.cjs', '/tmp/lingua.blob')).toEqual({
      main: '/tmp/lingua.cjs',
      output: '/tmp/lingua.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: 'none',
    });
  });

  it('rejects accidental files in the npm tarball', () => {
    const expected = ['LICENSE', 'README.md', 'bin/lingua.cjs', 'package.json'].map(path => ({
      path,
    }));
    expect(() => assertNpmPackContents(expected)).not.toThrow();
    expect(() => assertNpmPackContents([...expected, { path: '.env.production' }])).toThrow(
      /unexpected npm package contents/iu
    );
  });

  it('accepts the pnpm argument separator used by the release workflow', async () => {
    await expect(main(['--', '--help'])).resolves.toBe(0);
  });

  it('detects direct invocation with Windows paths', () => {
    const modulePath = 'D:\\a\\lingua\\lingua\\scripts\\package-cli.mjs';

    expect(isDirectInvocation(modulePath, modulePath, nodePath.win32)).toBe(true);
    expect(
      isDirectInvocation(
        modulePath,
        'D:\\a\\lingua\\lingua\\scripts\\build-cli.mjs',
        nodePath.win32
      )
    ).toBe(false);
    expect(isDirectInvocation(modulePath, undefined, nodePath.win32)).toBe(false);
  });

  it('keeps tar output local when packaging from a Windows runner', () => {
    expect(
      buildTarArchiveArgs({
        archiveName: 'lingua-cli-v1.0.0-windows-x64.tar.gz',
        outDir: 'D:\\a\\lingua\\lingua\\out-cli',
        releaseRoot:
          'D:\\a\\lingua\\lingua\\out-cli\\.staging\\windows-x64\\release',
        entries: ['lingua.exe', 'README.md', 'LICENSE'],
        pathApi: nodePath.win32,
      })
    ).toEqual([
      '-czf',
      'lingua-cli-v1.0.0-windows-x64.tar.gz',
      '-C',
      '.staging/windows-x64/release',
      'lingua.exe',
      'README.md',
      'LICENSE',
    ]);
  });

  it('rejects tar staging directories outside the output directory', () => {
    expect(() =>
      buildTarArchiveArgs({
        archiveName: 'lingua-cli-v1.0.0-windows-x64.tar.gz',
        outDir: 'D:\\a\\lingua\\lingua\\out-cli',
        releaseRoot: 'D:\\a\\lingua\\lingua\\release',
        entries: ['lingua.exe'],
        pathApi: nodePath.win32,
      })
    ).toThrow(/inside the output directory/iu);
  });
});
