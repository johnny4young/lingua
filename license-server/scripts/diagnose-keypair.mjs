#!/usr/bin/env node
/**
 * Standalone diagnostic — load the prod-keypair.json from disk and
 * exercise the same `crypto.subtle.importKey` / `sign` / `verify`
 * pipeline the worker uses. Tells you EXACTLY where the keypair fails
 * (parse / import / sign / verify) without having to redeploy the
 * worker between attempts.
 *
 * Usage:
 *   node license-server/scripts/diagnose-keypair.mjs ../prod-keypair.json
 */

import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { argv, exit } from 'node:process';

const path = argv[2] ?? 'prod-keypair.json';

const raw = await readFile(path, 'utf-8').catch((err) => {
  console.error(`✗ cannot read ${path}: ${err.message}`);
  exit(1);
});

let outer;
try {
  outer = JSON.parse(raw);
} catch (err) {
  console.error(`✗ outer JSON.parse failed: ${err.message}`);
  exit(1);
}

console.log(`✓ outer file parsed (${Object.keys(outer).join(', ')})`);

if (typeof outer.privateKeyJwkDoNotShip !== 'string') {
  console.error(`✗ privateKeyJwkDoNotShip is ${typeof outer.privateKeyJwkDoNotShip}, expected string`);
  exit(1);
}
if (typeof outer.publicKeyJwk !== 'string') {
  console.error(`✗ publicKeyJwk is ${typeof outer.publicKeyJwk}, expected string`);
  exit(1);
}

console.log(`✓ both JWK fields are strings (lengths: priv=${outer.privateKeyJwkDoNotShip.length}, pub=${outer.publicKeyJwk.length})`);

let privJwk, pubJwk;
try {
  privJwk = JSON.parse(outer.privateKeyJwkDoNotShip);
} catch (err) {
  console.error(`✗ inner JSON.parse(privateKeyJwkDoNotShip) failed: ${err.message}`);
  exit(1);
}
try {
  pubJwk = JSON.parse(outer.publicKeyJwk);
} catch (err) {
  console.error(`✗ inner JSON.parse(publicKeyJwk) failed: ${err.message}`);
  exit(1);
}

console.log(`✓ both JWK strings parsed to objects`);
console.log(`  private fields: ${Object.keys(privJwk).join(', ')}`);
console.log(`  public  fields: ${Object.keys(pubJwk).join(', ')}`);

// Mirror exactly what license-server/src/lib/sign.ts does on the worker.
let privKey, pubKey;
try {
  privKey = await webcrypto.subtle.importKey(
    'jwk',
    privJwk,
    { name: 'Ed25519' },
    false,
    ['sign']
  );
} catch (err) {
  console.error(`✗ importKey(private) failed: ${err.message}`);
  console.error(`  privJwk = ${JSON.stringify(privJwk, null, 2)}`);
  exit(1);
}
console.log(`✓ importKey(private) succeeded`);

try {
  pubKey = await webcrypto.subtle.importKey(
    'jwk',
    pubJwk,
    { name: 'Ed25519' },
    false,
    ['verify']
  );
} catch (err) {
  console.error(`✗ importKey(public) failed: ${err.message}`);
  exit(1);
}
console.log(`✓ importKey(public) succeeded`);

// Round-trip sign + verify
const message = new TextEncoder().encode('diagnostic-roundtrip');
let signature;
try {
  signature = await webcrypto.subtle.sign({ name: 'Ed25519' }, privKey, message);
} catch (err) {
  console.error(`✗ sign() failed: ${err.message}`);
  exit(1);
}
console.log(`✓ sign() succeeded (${signature.byteLength} bytes)`);

let verified;
try {
  verified = await webcrypto.subtle.verify({ name: 'Ed25519' }, pubKey, signature, message);
} catch (err) {
  console.error(`✗ verify() failed: ${err.message}`);
  exit(1);
}
if (!verified) {
  console.error(`✗ verify() returned false — keypair mismatch (private signed something the public can't verify)`);
  exit(1);
}
console.log(`✓ verify() succeeded — keypair is internally consistent`);

console.log(`\n✓✓ keypair file is valid end-to-end. If wrangler still rejects:`);
console.log(`   1. Check secrets are deployed: cd license-server && pnpm exec wrangler secret list`);
console.log(`   2. Re-upload BOTH secrets via stdin (jq -r, NOT -c)`);
console.log(`   3. Re-deploy: cd license-server && pnpm run deploy`);
console.log(`   4. Wait 30s for edge propagation, then re-run smoke`);
