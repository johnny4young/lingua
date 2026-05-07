#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_ARTIFACTS_ROOT = path.join(repoRoot, 'out', 'make');
export const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'output', 'linux-release-validation');

async function walkFiles(root, files = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function findLinuxPackageArtifacts(artifactsRoot) {
  const files = await walkFiles(artifactsRoot);
  return {
    deb: files.find(file => file.endsWith('.deb')) ?? null,
    rpm: files.find(file => file.endsWith('.rpm')) ?? null,
  };
}

function runCommand(
  command,
  args,
  { env = process.env, outputFile = null, allowFailure = false } = {}
) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (outputFile) {
    writeFileSync(outputFile, output);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${result.status ?? 'unknown'}\n${output}`
    );
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output,
  };
}

async function readSmokeSummary(summaryPath) {
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  if (!Array.isArray(summary.cases)) {
    throw new Error(`Smoke summary at ${summaryPath} is missing cases[]`);
  }
  const failures = summary.cases.filter(item => !item.ok);
  if (failures.length > 0) {
    throw new Error(
      `Linux packaged smoke failed: ${failures
        .map(item => `${item.language}: ${item.message}`)
        .join('; ')}`
    );
  }
  return summary;
}

export function buildMarkdownSummary(summary) {
  const lines = [
    '# Linux package validation',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '| Check | Result |',
    '|---|---|',
    `| Debian package | ${summary.deb.path} |`,
    `| RPM package | ${summary.rpm.path} |`,
    `| Installed binary | ${summary.installSmoke.binaryPath} |`,
    `| Packaged smoke | ${summary.installSmoke.caseCount} case(s), ${summary.installSmoke.failureCount} failure(s) |`,
    `| Uninstall | ${summary.installSmoke.uninstallVerified ? 'verified' : 'not verified'} |`,
  ];
  return `${lines.join('\n')}\n`;
}

async function validateLinuxReleaseArtifacts({
  artifactsRoot = DEFAULT_ARTIFACTS_ROOT,
  outputDir = DEFAULT_OUTPUT_DIR,
  skipInstallSmoke = false,
} = {}) {
  await mkdir(outputDir, { recursive: true });

  const artifacts = await findLinuxPackageArtifacts(artifactsRoot);
  if (!artifacts.deb) {
    throw new Error(`Expected a .deb package under ${artifactsRoot}`);
  }
  if (!artifacts.rpm) {
    throw new Error(`Expected a .rpm package under ${artifactsRoot}`);
  }

  const debInfoPath = path.join(outputDir, 'deb-info.txt');
  const debContentsPath = path.join(outputDir, 'deb-contents.txt');
  const rpmInfoPath = path.join(outputDir, 'rpm-info.txt');
  const rpmContentsPath = path.join(outputDir, 'rpm-contents.txt');
  const smokeArtifactDir = path.join(outputDir, 'packaged-smoke');
  const smokeSummaryPath = path.join(smokeArtifactDir, 'desktop-smoke-summary.json');

  runCommand('dpkg-deb', ['--info', artifacts.deb], { outputFile: debInfoPath });
  runCommand('dpkg-deb', ['--contents', artifacts.deb], { outputFile: debContentsPath });
  runCommand('rpm', ['-qpi', artifacts.rpm], { outputFile: rpmInfoPath });
  runCommand('rpm', ['-qpl', artifacts.rpm], { outputFile: rpmContentsPath });

  const installSmoke = {
    skipped: skipInstallSmoke,
    binaryPath: null,
    caseCount: 0,
    failureCount: 0,
    summaryPath: smokeSummaryPath,
    uninstallVerified: false,
  };

  if (!skipInstallSmoke) {
    if (process.platform !== 'linux') {
      throw new Error('Linux package install smoke must run on Linux');
    }

    await mkdir(smokeArtifactDir, { recursive: true });
    runCommand('sudo', ['apt-get', 'remove', '-y', 'lingua'], { allowFailure: true });
    runCommand('sudo', ['apt-get', 'install', '-y', artifacts.deb]);
    try {
      const which = runCommand('bash', ['-lc', 'command -v lingua']);
      installSmoke.binaryPath = which.stdout.trim();
      if (!installSmoke.binaryPath) {
        throw new Error('Installed lingua binary was not found on PATH');
      }

      runCommand(
        'xvfb-run',
        [
          '-a',
          'timeout',
          '180s',
          installSmoke.binaryPath,
          '--lingua-desktop-smoke',
          `--lingua-smoke-artifact-dir=${smokeArtifactDir}`,
        ],
        {
          env: {
            ...process.env,
            LINGUA_DESKTOP_SMOKE: '1',
            LINGUA_SMOKE_ARTIFACT_DIR: smokeArtifactDir,
            LINGUA_SMOKE_SECRET: '__lingua_smoke_secret__',
            LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET: '1',
            LINGUA_DESKTOP_SMOKE_OFFLINE: '1',
          },
          outputFile: path.join(outputDir, 'packaged-smoke.log'),
        }
      );
      const smokeSummary = await readSmokeSummary(smokeSummaryPath);
      installSmoke.caseCount = smokeSummary.cases.length;
      installSmoke.failureCount = smokeSummary.cases.filter(item => !item.ok).length;
    } finally {
      runCommand('sudo', ['apt-get', 'remove', '-y', 'lingua']);
    }
    const removed = runCommand('bash', ['-lc', 'command -v lingua'], { allowFailure: true });
    installSmoke.uninstallVerified = removed.status !== 0;
    if (!installSmoke.uninstallVerified) {
      throw new Error(`lingua binary still exists after uninstall: ${removed.stdout.trim()}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    artifactsRoot,
    deb: {
      path: artifacts.deb,
      infoPath: debInfoPath,
      contentsPath: debContentsPath,
    },
    rpm: {
      path: artifacts.rpm,
      infoPath: rpmInfoPath,
      contentsPath: rpmContentsPath,
    },
    installSmoke,
  };

  await writeFile(
    path.join(outputDir, 'linux-package-validation.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  await writeFile(
    path.join(outputDir, 'linux-package-validation.md'),
    buildMarkdownSummary(summary)
  );
  return summary;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-linux-release-artifacts.mjs [options]

Options:
  --artifacts-root <path>  Directory containing Forge Linux packages. Default: out/make
  --output-dir <path>      Directory for validation evidence. Default: output/linux-release-validation
  --skip-install-smoke     Only validate package metadata. Intended for tests, not release.
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'artifacts-root': { type: 'string' },
      'output-dir': { type: 'string' },
      'skip-install-smoke': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const summary = await validateLinuxReleaseArtifacts({
    artifactsRoot: values['artifacts-root']
      ? path.resolve(values['artifacts-root'])
      : DEFAULT_ARTIFACTS_ROOT,
    outputDir: values['output-dir'] ? path.resolve(values['output-dir']) : DEFAULT_OUTPUT_DIR,
    skipInstallSmoke: Boolean(values['skip-install-smoke']),
  });
  console.log(
    `linux-package-validation: ok (${summary.deb.path}, ${summary.rpm.path}, smoke cases ${summary.installSmoke.caseCount})`
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
