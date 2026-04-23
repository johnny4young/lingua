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
 *   npm run dev:desktop    # or: npm run dev:web
 *   # Then paste the token inside Settings > License > Paste license
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
