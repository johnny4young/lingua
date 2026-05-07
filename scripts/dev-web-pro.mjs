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
import { fileURLToPath, pathToFileURL } from 'node:url';
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
export const WEB_DEV_PRO_PORT = '5174';

export function buildViteDevServerArgs(passthroughArgs = [], trailingArgs = []) {
  return [
    viteBin,
    '--config',
    'vite.web.config.mts',
    '--port',
    WEB_DEV_PRO_PORT,
    '--strictPort',
    ...passthroughArgs,
    ...trailingArgs,
  ];
}

export function resolveVitePort(args = []) {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const arg = args[index] ?? '';
    if (arg.startsWith('--port=')) {
      return arg.slice('--port='.length) || WEB_DEV_PRO_PORT;
    }
    if (arg === '--port') {
      return args[index + 1] ?? WEB_DEV_PRO_PORT;
    }
  }
  return WEB_DEV_PRO_PORT;
}

export function buildViteDevServerEnv(publicKeyJwk, baseEnv = process.env) {
  return {
    ...baseEnv,
    VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: publicKeyJwk,
    // Dev tokens are signed by a throwaway local keypair, so they must
    // stay local-verify-only. If a maintainer has the production server
    // URL exported in their shell, override it here instead of letting the
    // real issuer reject the dev token with a misleading signature error.
    VITE_LINGUA_LICENSE_SERVER_URL: '',
  };
}

async function main() {
  const { tier, days, issuedTo, passthroughArgs, trailingArgs } = parseDevLicenseCliArgs(
    process.argv.slice(2),
    {
      defaultDays: 30,
      defaultIssuedTo: 'dev@localhost',
    }
  );
  const minted = await mintDevLicense({ tier, days, issuedTo });
  const viteArgs = buildViteDevServerArgs(passthroughArgs, trailingArgs);
  const displayPort = resolveVitePort([...passthroughArgs, ...trailingArgs]);

  printDevLicenseBanner({
    surface: 'web',
    tier,
    days,
    token: minted.token,
    launchLine: `Opening Vite on http://localhost:${displayPort} with --strictPort — close with Ctrl+C.`,
  });

  if (shouldSkipDevSessionLaunch()) {
    process.exit(0);
  }

  const child = spawn(process.execPath, viteArgs, {
    stdio: 'inherit',
    env: buildViteDevServerEnv(minted.publicKeyJwk),
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
