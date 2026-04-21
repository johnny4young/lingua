#!/usr/bin/env node
/**
 * Dev-only helper that mints a signed Ed25519 license token for manually
 * flipping the renderer into a paid tier while you test locally. Production
 * licenses come from the RL-061 issuer — this script exists so a developer
 * can exercise Pro-gated UI in web or Electron without hitting the issuer.
 *
 * Output: JSON on stdout with three fields:
 *   - publicKeyJwk: the Ed25519 public key, JSON-stringified again so you can
 *     set it via VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK='...' without quoting
 *     shenanigans.
 *   - token: the signed license token (payload.signature).
 *   - payload: the unsigned payload, for visibility.
 *
 * Flags (all optional):
 *   --tier <free|pro|pro_lifetime|team>   default: pro
 *   --days <number>                       support-window in days from now, default 365
 *   --issued-to <string>                  default: dev@localhost
 *
 * Usage (bash):
 *   node scripts/mint-dev-license.mjs --tier pro --days 30 > dev-license.json
 *   export VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK="$(jq -r .publicKeyJwk dev-license.json)"
 *   npm run desktop:dev    # or: npx vite --config vite.web.config.mts --port 5174
 *   # Then paste the token inside Settings > License > Paste license
 *
 * Nothing from this file ships in the app bundle. Do not import it from
 * renderer or main code.
 */

import { webcrypto } from 'node:crypto';

const SUBTLE = webcrypto.subtle;

const ARGS = parseArgs(process.argv.slice(2));
const TIER = ARGS.tier ?? 'pro';
const DAYS = Number(ARGS.days ?? '365');
const ISSUED_TO = ARGS['issued-to'] ?? 'dev@localhost';

const VALID_TIERS = new Set(['free', 'pro', 'pro_lifetime', 'team']);
if (!VALID_TIERS.has(TIER)) {
  console.error(`Unknown --tier "${TIER}". Use one of: ${[...VALID_TIERS].join(', ')}`);
  process.exit(1);
}
if (!Number.isFinite(DAYS) || DAYS <= 0) {
  console.error('--days must be a positive number');
  process.exit(1);
}

// Every entitlement the renderer recognizes today. Kept in sync manually with
// `src/shared/entitlements.ts`; a mismatch is harmless — the verifier only
// cares about the `tier` field, not the enumerated entitlements.
const KNOWN_ENTITLEMENTS = [
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
];

const now = new Date();
const supportEnds = new Date(now.getTime() + DAYS * 24 * 60 * 60 * 1000);

const payload = {
  productId: 'lingua',
  tier: TIER,
  issuedTo: ISSUED_TO,
  issuedAt: now.toISOString(),
  supportWindowEndsAt: supportEnds.toISOString(),
  entitlements: KNOWN_ENTITLEMENTS,
};

const keyPair = await SUBTLE.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const publicKeyJwk = await SUBTLE.exportKey('jwk', keyPair.publicKey);
const privateKeyJwk = await SUBTLE.exportKey('jwk', keyPair.privateKey);

const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
const payloadPart = base64UrlEncode(payloadBytes);
const signingInput = new TextEncoder().encode(payloadPart);
const signatureBytes = new Uint8Array(
  await SUBTLE.sign({ name: 'Ed25519' }, keyPair.privateKey, signingInput)
);
const token = `${payloadPart}.${base64UrlEncode(signatureBytes)}`;

process.stdout.write(
  `${JSON.stringify(
    {
      publicKeyJwk: JSON.stringify(publicKeyJwk),
      privateKeyJwkDoNotShip: JSON.stringify(privateKeyJwk),
      token,
      payload,
    },
    null,
    2
  )}\n`
);

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
  // Node's Buffer produces standard base64; rewrite to URL-safe and strip pad.
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
