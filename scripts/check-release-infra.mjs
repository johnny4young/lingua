#!/usr/bin/env node

/**
 * Release infra-readiness probe.
 *
 * Hits the public R2 runtime base (`R2_PUBLIC_BASE`, no secret required) and
 * asserts the web-runtime WASM assets the standalone web build depends on are
 * publicly readable WITH a CORS header for the web app origin. This is the
 * exact condition that broke the v0.7.0 web deploy (HTTP
 * 403, missing Access-Control-Allow-Origin) — but here it runs in seconds,
 * before any build, so a misconfigured bucket fails the preflight instead of a
 * 4-minute macOS build + a published draft release.
 *
 * Run standalone (`pnpm run check:release-infra`), inside `release:preflight`,
 * and as an early fail-fast job in `release.yml`. Pure logic + tests:
 * `scripts/lib/releaseInfra.mjs`, `tests/scripts/releaseInfra.test.ts`.
 *
 * Exit codes: 0 ready (warnings allowed), 1 not ready / misconfigured.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import {
  APP_ORIGIN,
  WEB_RUNTIME_ASSETS,
  buildRuntimeAssetUrl,
  classifyInfraProbe,
  summarizeInfraReadiness,
} from './lib/releaseInfra.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function readPackageVersion(pkg) {
  const pkgJsonPath = path.join(repoRoot, 'node_modules', pkg, 'package.json');
  try {
    const parsed = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * HEAD-probe a URL with the app Origin, retrying transient failures. Returns
 * the status (null on a network error) and the CORS header so the pure
 * classifier decides ok / warn / fail.
 */
async function probe(url, { attempts = 2, backoffMs = 2000 } = {}) {
  let status = null;
  let acao = null;
  let cfMitigated = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: { Origin: APP_ORIGIN },
        redirect: 'follow',
      });
      status = response.status;
      acao = response.headers.get('access-control-allow-origin');
      // `cf-mitigated` distinguishes a Cloudflare bot challenge from a real CORS
      // miss. (Only visible from a challenged IP — e.g. the CI runner, not a
      // residential dev box — so locally this stays null and the probe looks ok.)
      cfMitigated = response.headers.get('cf-mitigated');
      // 403/404 are deterministic policy answers — do not waste retries on them.
      if (status !== 502 && status !== 503 && status !== 504) break;
    } catch {
      status = null;
      acao = null;
      cfMitigated = null;
    }
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, backoffMs));
  }
  return { status, acao, cfMitigated };
}

function printHelp() {
  console.log(`Usage: node scripts/check-release-infra.mjs [--public-base <url>]

Probes the public R2 web-runtime store so a misconfigured bucket (no public access / no
CORS for ${APP_ORIGIN}) fails the release preflight instead of the deploy job.

Options:
  --public-base <url>  Override R2_PUBLIC_BASE (the public runtime base URL).
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      'public-base': { type: 'string' },
      'allow-missing-base': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    printHelp();
    return 0;
  }

  const publicBase = values['public-base'] ?? process.env.R2_PUBLIC_BASE ?? '';
  if (!publicBase) {
    // Local preflight convenience: a maintainer without R2_PUBLIC_BASE in their
    // env gets a skip-with-warning rather than a hard fail (the early CI job
    // runs WITHOUT this flag, so the bucket is still strictly probed there).
    if (values['allow-missing-base']) {
      console.log(
        'release-infra: R2_PUBLIC_BASE not set — skipping the web-runtime probe (set it to verify R2 readiness locally; CI probes it strictly).'
      );
      return 0;
    }
    const summary = summarizeInfraReadiness({ publicBaseConfigured: false, probes: [] });
    console.error(`release-infra: ${summary.configError}`);
    console.error(
      'release-infra: set R2_PUBLIC_BASE (the public runtime base, e.g. https://downloads.linguacode.dev) to probe readiness.'
    );
    return 1;
  }

  const targets = [];
  for (const asset of WEB_RUNTIME_ASSETS) {
    const version = await readPackageVersion(asset.pkg);
    if (version === null) {
      console.error(
        `release-infra: cannot resolve ${asset.pkg} version from node_modules; run pnpm install before the probe.`
      );
      return 1;
    }
    targets.push({
      kind: 'runtime-asset',
      url: buildRuntimeAssetUrl(publicBase, { lib: asset.lib, version, file: asset.file }),
    });
  }
  console.log(`release-infra: probing web runtimes at ${publicBase} (origin ${APP_ORIGIN})`);
  const probes = [];
  for (const target of targets) {
    const { status, acao, cfMitigated } = await probe(target.url);
    const result = classifyInfraProbe({
      url: target.url,
      kind: target.kind,
      status,
      acao,
      cfMitigated,
    });
    probes.push(result);
    const glyph = result.level === 'ok' ? 'ok ' : result.level === 'warn' ? 'warn' : 'FAIL';
    console.log(`  [${glyph}] ${target.url} — ${result.detail}`);
  }

  const summary = summarizeInfraReadiness({ publicBaseConfigured: true, probes });
  if (!summary.ok) {
    console.error(
      `release-infra: NOT ready — ${summary.failures.length} blocking finding(s). Configure the web-runtime bucket public access + CORS (docs/runbooks/r2-web-runtime-setup.md) before releasing.`
    );
    return 1;
  }
  if (summary.warnings.length > 0) {
    console.log(
      `release-infra: ready with ${summary.warnings.length} warning(s) — version-bumped runtime assets the deploy job will upload.`
    );
  } else {
    console.log('release-infra: ready (web-runtime assets are public + CORS-enabled).');
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
