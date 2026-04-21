#!/usr/bin/env node
/**
 * Dev wrapper that mints a dev Ed25519 keypair + a signed license token and
 * starts the web dev server with the public key wired into
 * VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK. The printed token can be pasted into
 * Settings → License; verification then succeeds end-to-end without any
 * extra exports.
 *
 * Usage:
 *   node scripts/dev-web-pro.mjs                # tier=pro, 30 days
 *   node scripts/dev-web-pro.mjs --tier team --days 7
 *
 * The keypair is generated fresh on every run. When the script exits, the
 * key is gone — start again to mint a new one.
 */

import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';

const ARGS = parseArgs(process.argv.slice(2));
const TIER = ARGS.tier ?? 'pro';
const DAYS = Number(ARGS.days ?? '30');

const VALID_TIERS = new Set(['free', 'pro', 'pro_lifetime', 'team']);
if (!VALID_TIERS.has(TIER)) {
  console.error(`Unknown --tier "${TIER}". Use one of: ${[...VALID_TIERS].join(', ')}`);
  process.exit(1);
}
if (!Number.isFinite(DAYS) || DAYS <= 0) {
  console.error('--days must be a positive number');
  process.exit(1);
}

const subtle = webcrypto.subtle;
const keyPair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey);

const now = new Date();
const supportEnds = new Date(now.getTime() + DAYS * 24 * 60 * 60 * 1000);
const payload = {
  productId: 'lingua',
  tier: TIER,
  issuedTo: 'dev@localhost',
  issuedAt: now.toISOString(),
  supportWindowEndsAt: supportEnds.toISOString(),
  entitlements: [
    'tabs',
    'snippets',
    'languages-extended',
    'dev-utilities',
    'variable-inspector',
    'themes-extra',
    'fonts-extra',
    'deep-links',
    'execution-history',
    'benchmarking',
    'local-ai',
    'notebook-mode',
  ],
};

const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
const signature = new Uint8Array(
  await subtle.sign(
    { name: 'Ed25519' },
    keyPair.privateKey,
    new TextEncoder().encode(payloadPart)
  )
);
const token = `${payloadPart}.${base64UrlEncode(signature)}`;

const separator = '─'.repeat(72);
console.log(separator);
console.log(`Lingua dev web server (tier: ${TIER}, valid ${DAYS} day(s))`);
console.log(separator);
console.log('Paste this token into Settings → License → "Paste a license token":');
console.log('');
console.log(token);
console.log('');
console.log(separator);
console.log('Opening vite on http://localhost:5174 — close with Ctrl+C.');
console.log(separator);

const child = spawn(
  'npx',
  ['vite', '--config', 'vite.web.config.mts', '--port', '5174'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: JSON.stringify(publicKeyJwk),
    },
  }
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
