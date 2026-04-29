#!/usr/bin/env node
/**
 * Dev wrapper that boots the managed Electron desktop launcher with the
 * **production** Lingua license public key baked in, so the local
 * verifier accepts tokens issued by the real Cloudflare worker
 * (`licenses.linguacode.dev`). Useful when smoking a paid Polar token
 * end-to-end without minting a throwaway dev keypair.
 *
 * Important: Slice 3 ships with the desktop main bridge in
 * **local-verify-only mode** — pasting a CF-issued token here flips
 * the pill to `Active · <tier>` and unlocks `useEntitlement(...)`,
 * but the desktop process does NOT call `/licenses/activate` (that
 * wiring is deferred to Slice 3.5, tracked under `[licensing]
 * 2026-04-28` in `docs/BACKLOG.md`). Until Slice 3.5 lands, the
 * Devices section will not render on desktop because `serverSync`
 * stays `'disabled'` and `devices` stays `null`. To exercise the
 * full server-aware path today, use the web build with
 * `npm run build:web` + paste a real CF token there.
 *
 * Usage:
 *   node scripts/dev-desktop-prod.mjs                 # local-verify with prod key
 *   node scripts/dev-desktop-prod.mjs -- --inspect-brk
 *
 * The script intentionally accepts no `--tier` / `--days` / `--issued-to`
 * flags: those would only matter for minting a token, and this wrapper
 * specifically expects the user to paste a real CF-signed token by
 * hand. Use `dev:desktop:pro` for a throwaway keypair instead.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const desktopLauncher = path.join(repoRoot, 'scripts', 'run-electron-desktop.mjs');
const envProductionPath = path.join(repoRoot, '.env.production');

/**
 * Minimal `.env`-style parser that accepts the shapes Lingua's
 * `.env.production` actually uses today: KEY='value', KEY="value",
 * KEY=value. Values starting with `$OTHER_KEY` get resolved against
 * the same map (single-level dereference) so the file can keep its
 * VITE_ aliases pointing at the canonical entry.
 */
function parseEnvFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const entries = new Map();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  // One pass of $VAR reference resolution so `VITE_X='$X'` lands the
  // same JWK as `X='{...}'`. Avoids requiring the user to maintain two
  // copies of the key in `.env.production`.
  for (const [key, value] of entries) {
    if (value.startsWith('$')) {
      const referenced = value.slice(1);
      const resolved = entries.get(referenced);
      if (typeof resolved === 'string') entries.set(key, resolved);
    }
  }
  return entries;
}

try {
  const env = parseEnvFile(envProductionPath);
  const publicKeyJwk = env.get('VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK');
  if (typeof publicKeyJwk !== 'string' || publicKeyJwk.length === 0) {
    throw new Error(
      `.env.production is missing VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK (or its referenced source). ` +
        `Make sure the file is in sync with the production keypair.`
    );
  }

  // Sanity-check: the key must be a parseable JWK with the Ed25519
  // shape Lingua uses end-to-end. A typo in `.env.production` would
  // otherwise surface as a confusing `no-public-key` reason on paste.
  let parsed;
  try {
    parsed = JSON.parse(publicKeyJwk);
  } catch (cause) {
    throw new Error(
      `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK in .env.production is not parseable JSON: ${cause.message}`
    );
  }
  if (parsed.kty !== 'OKP' || parsed.crv !== 'Ed25519' || typeof parsed.x !== 'string') {
    throw new Error(
      `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK is not an Ed25519 OKP public JWK ` +
        `(got kty=${parsed.kty}, crv=${parsed.crv}). Cannot start desktop launcher.`
    );
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Lingua desktop dev — production key baked in');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  Public key fingerprint (x): ${parsed.x.slice(0, 16)}…`);
  console.log('');
  console.log('  Paste a CF-signed token in Settings → License → Apply.');
  console.log('  The pill flips to Active locally; no server roundtrip');
  console.log('  happens (Slice 3.5 deferred — see docs/BACKLOG.md).');
  console.log('');
  console.log('  Close with Ctrl+C.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // `--sync-main` is mandatory: each invocation rewrites the env-injected
  // public key, and main bundles `__LINGUA_LICENSE_PUBLIC_KEY_JWK__` via
  // esbuild --define at build time. Without --sync-main a stale cached
  // main bundle from `dev:desktop:pro` (different key) would short-circuit
  // verification with `no-public-key`.
  const passthrough = process.argv.slice(2);
  const launchArgs = [desktopLauncher, '--sync-main', ...passthrough];

  const child = spawn(process.execPath, launchArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: publicKeyJwk,
      LINGUA_LICENSE_PUBLIC_KEY_JWK: publicKeyJwk,
    },
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
