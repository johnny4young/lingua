#!/usr/bin/env node
/**
 * Dev-only helper that mints a signed Ed25519 license token for manually
 * flipping the renderer into a paid tier while you test locally. Production
 * licenses come from the internal issuer — this script exists so a developer
 * can exercise Pro-gated UI in web or Electron without hitting the issuer.
 *
 * Output: JSON on stdout with FIVE fields. The two JWK fields are
 * **double-encoded on purpose** — the value is a JSON-string whose
 * contents are the actual JWK JSON object. This shape is friendly to
 * shell quoting (env vars, `wrangler secret put` stdin) but means
 * downstream tooling needs to know to unwrap one layer:
 *   - publicKeyJwk: STRING containing the Ed25519 public-key JWK as
 *     JSON, normalized to RFC 8037 §2 fields only (`kty`, `crv`, `x`).
 *     Pull it out with `jq -r .publicKeyJwk` (raw mode), NOT
 *     `jq -c` / `jq` (those re-encode and produce a JSON-string with
 *     escaped quotes — see "Common pitfall" below).
 *   - publicKeyJwkThumbprint: RFC 7638 thumbprint of publicKeyJwk
 *     (plain string, not double-encoded). internal — matches the
 *     'Signing key fingerprint' row in Settings → License and the
 *     key-registry id in docs/security/license-key-registry.json.
 *   - privateKeyJwkDoNotShip: STRING, same shape (`kty`, `crv`, `d`,
 *     `x`), the matching private key. Never commit this. Never paste
 *     it into the app.
 *   - token: the signed license token (payload.signature).
 *   - payload: the unsigned payload, for visibility.
 *
 * Why JWKs are stripped to RFC 8037 §2 only: Node 22+ webcrypto
 * adds `alg: "Ed25519"`, `key_ops`, and `ext` fields when exporting
 * an Ed25519 JWK. Cloudflare Workers' WebCrypto rejects
 * `alg: "Ed25519"` (the JOSE registry only knows `EdDSA` for this
 * curve), so a JWK round-tripped through `wrangler secret put`
 * fails `importKey` with a vague `DataError`. Stripping the optional
 * fields makes the JWK universally importable across Node, CF
 * Workers, and browser WebCrypto without per-runtime branches.
 * Pinned by `tests/scripts/mintDevLicense.test.ts`.
 *
 * Flags (all optional):
 *   --tier <free|pro|pro_lifetime|team>   default: pro
 *   --days <number>                       entitlement window in days (included-update window for pro_lifetime), default 365
 *   --issued-to <string>                  default: dev@localhost
 *
 * Usage (bash) — local dev with env-var public key:
 *   node scripts/mint-dev-license.mjs --tier pro --days 30 > dev-license.json
 *   export VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK="$(jq -r .publicKeyJwk dev-license.json)"
 *   pnpm run dev:desktop    # or: pnpm run dev:web
 *   # Then paste the token inside Settings > License > Paste license
 *
 * Usage (bash) — uploading the keypair to Cloudflare for license-server:
 *   node scripts/mint-dev-license.mjs --tier pro_lifetime --days 1 \
 *     --issued-to noreply@example.com > prod-keypair.json
 *
 *   # Sanity-check the file before you upload (note `fromjson` because
 *   # the JWK fields are double-encoded JSON strings):
 *   jq -e '.privateKeyJwkDoNotShip | fromjson | .kty == "OKP"' prod-keypair.json
 *
 *   # Pipe `jq -r` (RAW) into wrangler — never `jq -c` here:
 *   cd license-server
 *   jq -r .privateKeyJwkDoNotShip ../prod-keypair.json | \
 *     wrangler secret put LINGUA_LICENSE_PRIVATE_KEY_JWK
 *   jq -r .publicKeyJwk ../prod-keypair.json | \
 *     wrangler secret put LINGUA_LICENSE_PUBLIC_KEY_JWK
 *
 *   # Delete the keypair file once both secrets are uploaded:
 *   rm ../prod-keypair.json
 *
 * Common pitfall — `jq -c` vs `jq -r` for the JWK fields:
 *   `jq -c .privateKeyJwkDoNotShip prod-keypair.json` outputs
 *     "{\"kty\":\"OKP\",...,\"d\":\"...\"}"   (a quoted JSON-string)
 *   `jq -r .privateKeyJwkDoNotShip prod-keypair.json` outputs
 *     {"kty":"OKP",...,"d":"..."}             (the actual JWK)
 *   Cloudflare Workers do `JSON.parse(env.LINGUA_LICENSE_PRIVATE_KEY_JWK)`
 *   on the raw secret value. `-c` would parse to a STRING (not an
 *   object), and `crypto.subtle.importKey` would then fail with
 *   `invalid-private-key`. Always `-r` for these two fields.
 *
 * Nothing from this file ships in the app bundle. Do not import it from
 * renderer or main code.
 */

import process from 'node:process';
import {
  mintDevLicense,
  parseDevLicenseCliArgs,
} from './dev-license-shared.mjs';

try {
  const { tier, days, issuedTo } = parseDevLicenseCliArgs(process.argv.slice(2), {
    defaultDays: 365,
    defaultIssuedTo: 'dev@localhost',
  });
  const minted = await mintDevLicense({ tier, days, issuedTo });

  process.stdout.write(`${JSON.stringify(minted, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
