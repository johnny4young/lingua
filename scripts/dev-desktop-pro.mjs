#!/usr/bin/env node
/**
 * Dev wrapper that mints a throwaway signed license token and starts the
 * managed desktop launcher with the verification public key injected into the
 * renderer dev server environment.
 *
 * Usage:
 *   node scripts/dev-desktop-pro.mjs                 # tier=pro, 30 days
 *   node scripts/dev-desktop-pro.mjs --tier team --days 7 --issued-to you@local
 *   node scripts/dev-desktop-pro.mjs --sync-main --exit-after-ms 4000
 *   node scripts/dev-desktop-pro.mjs --sync-main -- --inspect-brk
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  mintDevLicense,
  parseDevLicenseCliArgs,
  printDevLicenseBanner,
  shouldSkipDevSessionLaunch,
} from './dev-license-shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const desktopLauncher = path.join(repoRoot, 'scripts', 'run-electron-desktop.mjs');

try {
  const { tier, days, issuedTo, passthroughArgs, trailingArgs } = parseDevLicenseCliArgs(
    process.argv.slice(2),
    {
      defaultDays: 30,
      defaultIssuedTo: 'dev@localhost',
    }
  );
  const minted = await mintDevLicense({ tier, days, issuedTo });

  printDevLicenseBanner({
    surface: 'desktop',
    tier,
    days,
    token: minted.token,
    launchLine: 'Opening the managed desktop launcher — close with Ctrl+C.',
  });

  if (shouldSkipDevSessionLaunch()) {
    process.exit(0);
  }

  const launchArgs = [desktopLauncher, ...passthroughArgs];
  if (trailingArgs.length > 0) {
    launchArgs.push('--', ...trailingArgs);
  }

  const child = spawn(process.execPath, launchArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: minted.publicKeyJwk,
    },
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
