#!/usr/bin/env node
/**
 * Dev wrapper that mints a throwaway signed license token and starts the web
 * dev server with the public key wired into
 * VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK. The printed token can be pasted into
 * Settings → License so paid-tier web flows verify end-to-end without
 * manual env exports.
 *
 * Usage:
 *   node scripts/dev-web-pro.mjs                # tier=pro, 30 days
 *   node scripts/dev-web-pro.mjs --tier team --days 7 --issued-to you@local
 *   node scripts/dev-web-pro.mjs -- --host 127.0.0.1
 *
 * The keypair is generated fresh on every run. When the script exits, the
 * key is gone — start again to mint a new one.
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
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

try {
  const { tier, days, issuedTo, passthroughArgs } = parseDevLicenseCliArgs(
    process.argv.slice(2),
    {
      defaultDays: 30,
      defaultIssuedTo: 'dev@localhost',
    }
  );
  const minted = await mintDevLicense({ tier, days, issuedTo });

  printDevLicenseBanner({
    surface: 'web',
    tier,
    days,
    token: minted.token,
    launchLine: 'Opening Vite on http://localhost:5174 — close with Ctrl+C.',
  });

  if (shouldSkipDevSessionLaunch()) {
    process.exit(0);
  }

  const child = spawn(
    process.execPath,
    [viteBin, '--config', 'vite.web.config.mts', '--port', '5174', ...passthroughArgs],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: minted.publicKeyJwk,
      },
    }
  );

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
