import { webcrypto } from 'node:crypto';
import process from 'node:process';

const DAY_MS = 24 * 60 * 60 * 1000;
const SUBTLE = webcrypto.subtle;

export const VALID_DEV_LICENSE_TIERS = ['free', 'pro', 'pro_lifetime', 'team'];

// Kept in sync manually with `src/shared/entitlements.ts`. A mismatch is
// harmless for verification; the renderer gates on `tier`, not on this list.
export const KNOWN_ENTITLEMENTS = [
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

export function parseDevLicenseCliArgs(
  argv,
  {
    defaultTier = 'pro',
    defaultDays = 365,
    defaultIssuedTo = 'dev@localhost',
  } = {}
) {
  const parsed = {
    tier: defaultTier,
    days: defaultDays,
    issuedTo: defaultIssuedTo,
    passthroughArgs: [],
    trailingArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--') {
      parsed.trailingArgs = argv.slice(index + 1);
      break;
    }

    if (arg.startsWith('--tier=')) {
      parsed.tier = arg.slice('--tier='.length);
      continue;
    }

    if (arg === '--tier') {
      const value = readRequiredValue(argv, index, '--tier');
      parsed.tier = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--days=')) {
      parsed.days = Number(arg.slice('--days='.length));
      continue;
    }

    if (arg === '--days') {
      const value = readRequiredValue(argv, index, '--days');
      parsed.days = Number(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--issued-to=')) {
      parsed.issuedTo = arg.slice('--issued-to='.length);
      continue;
    }

    if (arg === '--issued-to') {
      const value = readRequiredValue(argv, index, '--issued-to');
      parsed.issuedTo = value;
      index += 1;
      continue;
    }

    parsed.passthroughArgs.push(arg);
    if (
      arg.startsWith('--') &&
      !arg.includes('=') &&
      argv[index + 1] !== undefined &&
      !(argv[index + 1] ?? '').startsWith('--')
    ) {
      parsed.passthroughArgs.push(argv[index + 1] ?? '');
      index += 1;
    }
  }

  validateDevLicenseOptions(parsed);
  return parsed;
}

export function validateDevLicenseOptions({ tier, days, issuedTo }) {
  if (!VALID_DEV_LICENSE_TIERS.includes(tier)) {
    throw new Error(
      `Unknown --tier "${tier}". Use one of: ${VALID_DEV_LICENSE_TIERS.join(', ')}`
    );
  }

  if (!Number.isFinite(days) || days < 0) {
    throw new Error('--days must be zero or a positive number');
  }

  if (typeof issuedTo !== 'string' || issuedTo.trim().length === 0) {
    throw new Error('--issued-to must be a non-empty string');
  }
}

export async function mintDevLicense({
  tier = 'pro',
  days = 365,
  issuedTo = 'dev@localhost',
} = {}) {
  validateDevLicenseOptions({ tier, days, issuedTo });

  const now = new Date();
  const supportWindowEndsAt = new Date(
    now.getTime() + days * DAY_MS
  ).toISOString();

  const payload = {
    productId: 'lingua',
    tier,
    issuedTo,
    issuedAt: now.toISOString(),
    supportWindowEndsAt,
    entitlements: KNOWN_ENTITLEMENTS,
  };

  const keyPair = await SUBTLE.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ]);
  const publicKeyJwk = await SUBTLE.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await SUBTLE.exportKey('jwk', keyPair.privateKey);

  const payloadPart = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signatureBytes = new Uint8Array(
    await SUBTLE.sign(
      { name: 'Ed25519' },
      keyPair.privateKey,
      new TextEncoder().encode(payloadPart)
    )
  );

  // The JWK fields are JSON-stringified intentionally — the consumer
  // contract expects a string, not an embedded object, so shells can
  // round-trip them through env vars / `wrangler secret put` stdin
  // without quoting issues. See `scripts/mint-dev-license.mjs` doc-
  // comment for the `jq -r` (NOT `-c`) extraction pattern. Do NOT
  // change this to return embedded objects without updating every
  // downstream caller (the Vite define on the desktop launcher,
  // `npm run dev:desktop:pro`, and the wrangler-secret usage in
  // `license-server/README.md`).
  return {
    publicKeyJwk: JSON.stringify(normalizeEd25519PublicJwk(publicKeyJwk)),
    privateKeyJwkDoNotShip: JSON.stringify(normalizeEd25519PrivateJwk(privateKeyJwk)),
    token: `${payloadPart}.${base64UrlEncode(signatureBytes)}`,
    payload,
  };
}

/**
 * Strip every JWK field that is not in RFC 8037 §2 for Ed25519
 * (`kty`, `crv`, `x`, plus `d` for private). Node 22+ webcrypto
 * `exportKey('jwk', …)` adds `alg: "Ed25519"`, `key_ops`, and `ext`
 * to the JWK; Cloudflare Workers' WebCrypto rejects `alg: "Ed25519"`
 * (the JOSE registry only defines `EdDSA` for Ed25519, not the curve
 * name) and the `importKey` call fails with a vague `DataError`,
 * surfacing as `invalid-private-key` from `license-server/src/lib/sign.ts`.
 *
 * Stripping is a one-line normalize that keeps the worker happy
 * across Node ↔ CF ↔ browser without making any consumer aware of
 * the per-runtime variance. Tests pin the absence of the optional
 * fields so the next time someone adds a Node-22-ism we catch it.
 */
function normalizeEd25519PrivateJwk(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x };
}

function normalizeEd25519PublicJwk(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
}

export function printDevLicenseBanner({
  surface,
  tier,
  days,
  token,
  launchLine,
}) {
  const separator = '─'.repeat(72);
  console.log(separator);
  console.log(`Lingua dev ${surface} session (tier: ${tier}, valid ${days} day(s))`);
  console.log(separator);
  console.log('Paste this token into Settings → License → "Paste a license token":');
  console.log('');
  console.log(token);
  console.log('');
  console.log(separator);
  console.log(launchLine);
  console.log(separator);
}

export function shouldSkipDevSessionLaunch() {
  return process.env.LINGUA_DEV_SESSION_SKIP_LAUNCH === '1';
}

export function readRequiredValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
