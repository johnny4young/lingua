#!/usr/bin/env node

/**
 * RL-143 release-time guard: assert the embedded license-signing public key
 * satisfies the rotation policy BEFORE anything user-facing is built.
 *
 * What this closes: the Ed25519 public key committed in `.env.production`
 * carries no `kid` or issuance date (CF Workers rejects JWK fields beyond
 * RFC 8037 §2), so nothing would otherwise stop a stale or undocumented key
 * from shipping for another year. This guard reads the committed
 * `.env.production`, computes the RFC 7638 thumbprint, and checks it against
 * `docs/security/license-key-registry.json`: the key must be documented,
 * `active`, and younger than the rotation SLA. The dev `.env` is gitignored
 * (absent in CI / fresh clones, which is fine); when it IS present its key
 * must match `.env.production`. The rotation runbook lives in
 * `docs/RELEASE_SECURITY.md` § Licensing.
 *
 * Wired into: `.github/workflows/release.yml` (security-audit job),
 * `.github/workflows/deploy-web.yml` (manual web deploys bypass release),
 * and `.github/workflows/ci.yml` (PR-time early signal, so the SLA breach
 * surfaces the week it happens instead of on release day).
 *
 * Pure logic + tests: `scripts/lib/licenseKeyRotation.mjs`,
 * `tests/scripts/licenseKeyRotation.test.ts`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import { evaluateLicenseKeyRotation } from './lib/licenseKeyRotation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_ENV_PRODUCTION_PATH = path.join(repoRoot, '.env.production');
export const DEFAULT_ENV_PATH = path.join(repoRoot, '.env');
export const DEFAULT_REGISTRY_PATH = path.join(
  repoRoot,
  'docs',
  'security',
  'license-key-registry.json'
);

/**
 * Read a file as UTF-8, mapping ENOENT to null so the evaluator reports a
 * policy failure ("file does not define the key") instead of a raw stack.
 *
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function printHelp() {
  console.log(`Usage: node scripts/assert-license-key-rotation.mjs [options]

Asserts the embedded license public key (LINGUA_LICENSE_PUBLIC_KEY_JWK) is
documented in the key registry, active, identical in .env/.env.production,
and younger than the rotation SLA. Fails closed before any release build.

Options:
  --env-production <path>  Production env file. Default: .env.production
  --env <path>             Dev env file. Default: .env
  --registry <path>        Key registry JSON. Default: docs/security/license-key-registry.json
  --now <ISO date>         Clock override for tests. Default: current time
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      'env-production': { type: 'string' },
      env: { type: 'string' },
      registry: { type: 'string' },
      now: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const nowMs = values.now ? Date.parse(values.now) : Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error(`--now must be an ISO date/time (got "${values.now}").`);
  }

  const productionEnvPath = values['env-production']
    ? path.resolve(values['env-production'])
    : DEFAULT_ENV_PRODUCTION_PATH;
  const envPath = values.env ? path.resolve(values.env) : DEFAULT_ENV_PATH;
  const registryPath = values.registry ? path.resolve(values.registry) : DEFAULT_REGISTRY_PATH;

  const [productionEnvText, devEnvText, registryText] = await Promise.all([
    readOptionalFile(productionEnvPath),
    readOptionalFile(envPath),
    readOptionalFile(registryPath),
  ]);

  let registry = null;
  if (registryText !== null) {
    try {
      registry = JSON.parse(registryText);
    } catch {
      // Leave registry null — the evaluator reports the malformed-registry
      // failure with the canonical message instead of a JSON stack trace.
    }
  }

  const result = evaluateLicenseKeyRotation({ productionEnvText, devEnvText, registry, nowMs });

  for (const warning of result.warnings) {
    // `::warning::` renders as a GitHub Actions annotation. It must go to
    // STDOUT — the Actions runner scans stdout for workflow commands, so a
    // stderr warning would print but not annotate. Locally it is just a
    // prefixed line.
    console.log(`::warning::license-key-rotation: ${warning}`);
  }

  if (!result.ok) {
    for (const failure of result.failures) {
      console.error(`license-key-rotation: ${failure}`);
    }
    return 1;
  }

  console.log(
    `license-key-rotation: ok (thumbprint ${result.thumbprint}, age ${result.ageDays} day(s), SLA ${result.slaDays} days)`
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
