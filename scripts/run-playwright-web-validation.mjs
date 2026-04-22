#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const playwrightBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
);

const mintedLicense = JSON.parse(
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'mint-dev-license.mjs'),
      '--tier',
      'pro',
      '--days',
      '7',
      '--issued-to',
      'playwright@local',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  )
);

const child = spawn(
  playwrightBin,
  ['test', '-c', 'playwright.license-web.config.mts', ...process.argv.slice(2)],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      LINGUA_DEV_LICENSE_PUBLIC_KEY_JWK: mintedLicense.publicKeyJwk,
      LINGUA_DEV_LICENSE_TOKEN: mintedLicense.token,
    },
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
