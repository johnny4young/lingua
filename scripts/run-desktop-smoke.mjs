#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const artifactDir = path.join(repoRoot, 'output', 'playwright', 'desktop-smoke');
const progressPath = path.join(artifactDir, 'desktop-smoke-progress.json');
const summaryPath = path.join(artifactDir, 'desktop-smoke-summary.json');
const maxSmokeRuntimeMs = 180_000;

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });

  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'run-electron-desktop.mjs'),
      '--sync-main',
      '--',
      '--lingua-desktop-smoke',
      `--lingua-smoke-artifact-dir=${artifactDir}`,
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        LINGUA_ELECTRON_LAUNCHER:
          process.platform === 'darwin'
            ? process.env.LINGUA_ELECTRON_LAUNCHER ?? 'open'
            : process.env.LINGUA_ELECTRON_LAUNCHER,
        LINGUA_DESKTOP_SMOKE: '1',
        LINGUA_SMOKE_ARTIFACT_DIR: artifactDir,
      },
    }
  );

  const timeoutId = setTimeout(() => {
    console.error(
      `[desktop-smoke] Timed out after ${maxSmokeRuntimeMs}ms; terminating Electron smoke run`
    );
    terminateChild(child);
  }, maxSmokeRuntimeMs);

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  clearTimeout(timeoutId);

  try {
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    const failedCases = summary.cases.filter((item) => !item.ok);

    console.log(`[desktop-smoke] Artifacts: ${artifactDir}`);
    console.log(`[desktop-smoke] Cases: ${summary.cases.length}, failures: ${failedCases.length}`);

    if (failedCases.length > 0) {
      for (const failedCase of failedCases) {
        console.error(
          `[desktop-smoke] ${failedCase.language} failed: ${failedCase.message}`
        );
      }
    }
  } catch (error) {
    const progress = await readJsonIfPresent(progressPath);
    console.error(
      `[desktop-smoke] Failed to read smoke summary at ${summaryPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    if (progress) {
      console.error(`[desktop-smoke] Last known progress: ${JSON.stringify(progress)}`);
    }
    process.exit(1);
  }

  process.exit(exitCode);
}

await main();
