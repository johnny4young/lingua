#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const knipEntry = path.join(root, 'node_modules/knip/bin/knip.js');
const probes = [
  ['root', 'src/__knip_negative_probe__.ts'],
  ['website', 'website/src/__knip_negative_probe__.ts'],
  ['license-server', 'license-server/src/__knip_negative_probe__.ts'],
  ['update-server', 'update-server/src/__knip_negative_probe__.ts'],
];

function runKnip(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [knipEntry, '--no-progress', ...args], {
      cwd: root,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

const created = [];
try {
  for (const [, relativePath] of probes) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, 'export const unreachableKnipProbe = true;\n', { flag: 'wx' });
    created.push(absolutePath);
  }

  const result = await runKnip(['--include', 'files', '--reporter', 'json', '--no-exit-code']);
  if (result.code !== 0) {
    throw new Error(`Knip probe exited ${result.code}:\n${result.stderr || result.stdout}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Knip did not emit valid JSON:\n${result.stdout}\n${result.stderr}`, {
      cause: error,
    });
  }
  const unusedFiles = new Set(
    report.issues.flatMap(issue => issue.files?.map(file => file.name) ?? [])
  );
  const missing = probes.filter(([, relativePath]) => !unusedFiles.has(relativePath));
  if (missing.length > 0) {
    throw new Error(
      `Dead-code configuration missed package probes: ${missing.map(([name]) => name).join(', ')}`
    );
  }

  console.log(`Dead-code package boundary probes passed (${probes.length} packages).`);
} finally {
  await Promise.all(created.map(file => rm(file, { force: true })));
}
