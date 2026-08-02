#!/usr/bin/env node

/**
 * Build the two distributable Lingua CLI surfaces:
 *
 * - a minimal, dependency-free npm tarball for Node.js 24.x;
 * - a Node single-executable archive for the current Windows/Linux host.
 *
 * Standalone executables are built natively so the preparation blob and Node
 * binary always match. Windows signing is opt-in and happens after SEA
 * injection, before the archive is written. macOS is deliberately served by
 * the npm package until the raw CLI binary has its own notarization path.
 */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';
import {
  assertNpmPackContents,
  buildCliPackageManifest,
  CLI_PACKAGE_NAME,
} from './cli-package-contract.mjs';

export {
  assertNpmPackContents,
  buildCliPackageManifest,
  CLI_PACKAGE_NAME,
} from './cli-package-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const SEA_SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
export const SUPPORTED_STANDALONE_TARGETS = Object.freeze(['linux-x64', 'windows-x64']);

export function resolveStandaloneTarget(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'windows' : platform;
  const target = `${os}-${arch}`;
  if (!SUPPORTED_STANDALONE_TARGETS.includes(target)) {
    throw new Error(
      `Standalone CLI target ${target} is not supported. Supported targets: ${SUPPORTED_STANDALONE_TARGETS.join(', ')}. Use the npm package on other platforms.`
    );
  }
  return target;
}

export function canBuildStandalone(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'windows' : platform;
  return SUPPORTED_STANDALONE_TARGETS.includes(`${os}-${arch}`);
}

export function cliBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'lingua.exe' : 'lingua';
}

export function cliArchiveName(version, target) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Invalid CLI version: ${String(version)}`);
  }
  if (!SUPPORTED_STANDALONE_TARGETS.includes(target)) {
    throw new Error(`Unsupported standalone CLI target: ${target}`);
  }
  return `lingua-cli-v${version}-${target}.tar.gz`;
}

export function buildSeaConfig(main, output) {
  return {
    main,
    output,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    // Match the desktop shell's hardening: the public executable must not let
    // NODE_OPTIONS silently alter the runtime contract.
    execArgvExtension: 'none',
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? `${result.stderr || result.stdout || ''}`.trim()
      : `exit ${String(result.status)}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result;
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), async source => {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest('hex');
}

function buildCliBundle() {
  run(process.execPath, [path.join(repoRoot, 'scripts', 'build-cli.mjs')]);
  const bundle = path.join(repoRoot, 'dist', 'cli', 'lingua.cjs');
  if (!existsSync(bundle)) throw new Error(`CLI bundle was not written: ${bundle}`);
  return bundle;
}

async function packageForNpm({ bundle, outDir, rootPackage }) {
  const staging = path.join(outDir, '.staging', 'npm');
  rmSync(staging, { recursive: true, force: true });
  await mkdir(path.join(staging, 'bin'), { recursive: true });
  await cp(bundle, path.join(staging, 'bin', 'lingua.cjs'));
  chmodSync(path.join(staging, 'bin', 'lingua.cjs'), 0o755);
  await cp(path.join(repoRoot, 'packaging', 'cli', 'README.md'), path.join(staging, 'README.md'));
  await cp(path.join(repoRoot, 'LICENSE'), path.join(staging, 'LICENSE'));
  await writeFile(
    path.join(staging, 'package.json'),
    `${JSON.stringify(buildCliPackageManifest(rootPackage), null, 2)}\n`,
    'utf8'
  );

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = run(npm, ['pack', '--json', '--pack-destination', outDir], {
    cwd: staging,
    capture: true,
    // Never depend on or mutate the maintainer's global npm cache. Besides
    // making release packaging hermetic, this avoids inherited ownership
    // problems from old npm versions.
    env: {
      ...process.env,
      npm_config_cache: path.join(outDir, '.npm-cache'),
      npm_config_update_notifier: 'false',
    },
  });
  const report = JSON.parse(packed.stdout);
  if (!Array.isArray(report) || report.length !== 1) {
    throw new Error(`npm pack returned an unexpected report: ${packed.stdout}`);
  }
  assertNpmPackContents(report[0].files ?? []);
  const artifactPath = path.join(outDir, report[0].filename);
  if (!existsSync(artifactPath)) throw new Error(`npm package was not written: ${artifactPath}`);
  return {
    kind: 'npm-package',
    name: path.basename(artifactPath),
    path: artifactPath,
    bytes: statSync(artifactPath).size,
    sha256: await hashFile(artifactPath),
    integrity: report[0].integrity,
  };
}

async function signWindowsBinary(binaryDir) {
  const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
  const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
  if (!certificateFile || !certificatePassword) {
    throw new Error(
      'Windows signing requested but WINDOWS_CERTIFICATE_FILE and WINDOWS_CERTIFICATE_PASSWORD are not both set.'
    );
  }
  const { sign } = await import('@electron/windows-sign');
  await sign({
    appDirectory: binaryDir,
    certificateFile,
    certificatePassword,
    description: 'Lingua CLI',
    website: 'https://linguacode.dev',
    hashes: ['sha256'],
  });
}

async function packageStandalone({ bundle, outDir, rootPackage, expectTarget, signWindows }) {
  const target = resolveStandaloneTarget();
  if (expectTarget && expectTarget !== target) {
    throw new Error(`Expected standalone target ${expectTarget}, but this host is ${target}.`);
  }

  const staging = path.join(outDir, '.staging', target);
  const releaseRoot = path.join(staging, 'release');
  rmSync(staging, { recursive: true, force: true });
  await mkdir(releaseRoot, { recursive: true });

  const blob = path.join(staging, 'lingua.blob');
  const seaConfig = path.join(staging, 'sea-config.json');
  await writeFile(seaConfig, `${JSON.stringify(buildSeaConfig(bundle, blob), null, 2)}\n`, 'utf8');
  run(process.execPath, ['--experimental-sea-config', seaConfig]);

  const binaryName = cliBinaryName();
  const binaryPath = path.join(releaseRoot, binaryName);
  copyFileSync(process.execPath, binaryPath);
  chmodSync(binaryPath, 0o755);

  await inject(binaryPath, 'NODE_SEA_BLOB', readFileSync(blob), {
    sentinelFuse: SEA_SENTINEL_FUSE,
  });

  if (process.platform === 'win32' && signWindows) {
    await signWindowsBinary(releaseRoot);
  } else if (signWindows) {
    throw new Error('--sign-windows can only be used on a Windows host.');
  }

  const versionSmoke = run(binaryPath, ['--version'], { capture: true });
  if (versionSmoke.stdout.trim() !== rootPackage.version) {
    throw new Error(
      `Standalone CLI version mismatch: expected ${rootPackage.version}, got ${versionSmoke.stdout.trim()}`
    );
  }
  const utilitySmoke = run(binaryPath, ['utility', 'base64-encode'], {
    capture: true,
    input: 'hello',
  });
  if (utilitySmoke.stdout.trim() !== 'aGVsbG8=') {
    throw new Error(`Standalone CLI utility smoke failed: ${utilitySmoke.stdout.trim()}`);
  }

  await cp(
    path.join(repoRoot, 'packaging', 'cli', 'README.md'),
    path.join(releaseRoot, 'README.md')
  );
  await cp(path.join(repoRoot, 'LICENSE'), path.join(releaseRoot, 'LICENSE'));
  const archiveName = cliArchiveName(rootPackage.version, target);
  const archivePath = path.join(outDir, archiveName);
  rmSync(archivePath, { force: true });
  run('tar', ['-czf', archivePath, '-C', releaseRoot, binaryName, 'README.md', 'LICENSE']);

  return {
    kind: 'standalone',
    target,
    name: archiveName,
    path: archivePath,
    binaryPath,
    bytes: statSync(archivePath).size,
    binaryBytes: statSync(binaryPath).size,
    sha256: await hashFile(archivePath),
    signed: process.platform === 'win32' && signWindows,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/package-cli.mjs [options]

Build a publishable npm tarball and/or a native standalone CLI archive.

Options:
  --out-dir <path>       Output directory (default: out-cli)
  --package-only         Build only the npm package
  --binary-only          Build only the native standalone archive
  --expect-target <id>   Fail unless this host matches linux-x64 or windows-x64
  --sign-windows         Sign the injected Windows executable before archiving
  -h, --help             Show this help
`);
}

export async function main(argv = process.argv.slice(2)) {
  // pnpm 11 preserves the separator used by `pnpm run <script> -- <args>`.
  // Node's parseArgs treats that marker as a positional unless we remove it.
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args,
    options: {
      'out-dir': { type: 'string', default: 'out-cli' },
      'package-only': { type: 'boolean', default: false },
      'binary-only': { type: 'boolean', default: false },
      'expect-target': { type: 'string' },
      'sign-windows': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    printHelp();
    return 0;
  }
  if (values['package-only'] && values['binary-only']) {
    throw new Error('--package-only and --binary-only are mutually exclusive.');
  }
  if (values['sign-windows'] && values['package-only']) {
    throw new Error('--sign-windows requires a standalone binary build.');
  }

  const outDir = path.resolve(repoRoot, values['out-dir']);
  mkdirSync(outDir, { recursive: true });
  const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const bundle = buildCliBundle();
  const artifacts = [];

  if (!values['binary-only']) {
    artifacts.push(await packageForNpm({ bundle, outDir, rootPackage }));
  }
  const shouldBuildStandalone =
    !values['package-only'] &&
    (values['binary-only'] || canBuildStandalone() || Boolean(values['expect-target']));
  if (shouldBuildStandalone) {
    artifacts.push(
      await packageStandalone({
        bundle,
        outDir,
        rootPackage,
        expectTarget: values['expect-target'],
        signWindows: values['sign-windows'],
      })
    );
  } else if (!values['package-only']) {
    console.warn(
      `[package-cli] standalone archive skipped on ${process.platform}-${process.arch}; npm is the supported CLI channel on this host.`
    );
  }

  const report = {
    package: CLI_PACKAGE_NAME,
    version: rootPackage.version,
    node: process.version,
    artifacts: artifacts.map(artifact => ({
      ...artifact,
      path: path.relative(repoRoot, artifact.path),
      ...(artifact.binaryPath ? { binaryPath: path.relative(repoRoot, artifact.binaryPath) } : {}),
    })),
  };
  const reportPath = path.join(outDir, 'cli-distribution.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(`[package-cli] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  );
}
