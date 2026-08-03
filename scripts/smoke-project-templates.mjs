#!/usr/bin/env node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  loadCuratedProjectTemplates,
  runProjectTemplateRuntimeSmoke,
} from './lib/projectTemplateRuntimeSmoke.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function usage() {
  return `Usage: node scripts/smoke-project-templates.mjs [options]

Materialize, install, and execute every curated multi-file project template.

Options:
  --artifact-dir <path>  JSON artifact directory (default: output/project-template-smoke)
  --python <path>        Python executable used to create isolated virtual environments
  --keep-workdir         Preserve the temporary generated projects for debugging
  --help                 Show this help
`;
}

function parseArgs(argv) {
  const options = {
    artifactDir: path.join(repoRoot, 'output', 'project-template-smoke'),
    pythonExecutable: process.env.PYTHON || 'python3',
    keepWorkdir: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { ...options, help: true };
    if (arg === '--keep-workdir') {
      options.keepWorkdir = true;
      continue;
    }
    if (arg === '--artifact-dir' || arg === '--python') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      if (arg === '--artifact-dir') options.artifactDir = path.resolve(value);
      else options.pythonExecutable = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function writeSummary(artifactDir, summary) {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, 'project-template-smoke-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[project-template-smoke] ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const workingRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-project-template-smoke-'));
  const startedAt = performance.now();
  let cases = [];
  let fatalError;
  try {
    const templates = await loadCuratedProjectTemplates(repoRoot);
    cases = await runProjectTemplateRuntimeSmoke({
      templates,
      workingRoot,
      pythonExecutable: options.pythonExecutable,
      onProgress(event) {
        if (event.type === 'started') {
          console.log(`[project-template-smoke] ${event.templateId}: starting`);
          return;
        }
        const marker = event.ok ? 'ok' : 'FAILED';
        console.log(
          `[project-template-smoke] ${event.templateId}: ${marker} (${event.durationMs}ms) — ${event.message}`
        );
      },
    });
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    pythonExecutable: options.pythonExecutable,
    durationMs: Math.round(performance.now() - startedAt),
    success: !fatalError && cases.length > 0 && cases.every(item => item.ok),
    cases,
    ...(fatalError ? { error: fatalError } : {}),
    ...(options.keepWorkdir ? { workingRoot } : {}),
  };
  await writeSummary(options.artifactDir, summary);
  console.log(`[project-template-smoke] Artifact: ${options.artifactDir}`);
  if (options.keepWorkdir) {
    console.log(`[project-template-smoke] Generated projects: ${workingRoot}`);
  } else {
    await rm(workingRoot, { recursive: true, force: true });
  }

  if (!summary.success) process.exitCode = 1;
}

await main();
