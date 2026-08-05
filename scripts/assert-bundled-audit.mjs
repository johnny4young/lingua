#!/usr/bin/env node

/**
 * Release/PR-time guard: fail closed when a dependency that Vite INLINES into
 * the packaged desktop main or preload bundle carries an advisory at or above
 * a severity threshold (default high).
 *
 * What this closes: `check:prod-audit` runs `pnpm audit --prod`, which only
 * sees `dependencies`. Vite bundles the main/preload graphs, so a package
 * imported by `src/main/**` ships inside `.vite/build/main.js` no matter how
 * it is declared. `undici` (the SSRF-guarded HTTP proxy) and `ws` (the live
 * WebSocket transport) are declared as devDependencies and were therefore
 * invisible to the blocking gate; `undici` shipped on 7.28.0 against an
 * advisory requiring >= 7.29.0 with CI green.
 *
 * Why not simply move them to `dependencies`: that would make electron-builder
 * ship them a second time as unpacked `node_modules` alongside the copy Vite
 * already inlined. The bundler's view is the honest one, so this gate reads it
 * directly.
 *
 * Scope: main + preload. Those run with full OS privileges outside the browser
 * sandbox. The renderer graph is deliberately not covered here — see
 * docs/RELEASE_SECURITY.md.
 *
 * The external list comes from the REAL resolved Vite configs rather than a
 * copy, so a package moving in or out of `rollupOptions.external` cannot
 * silently change what this gate audits.
 *
 * Modes:
 * - default: spawn `pnpm audit --json` (full graph) and filter to the bundled
 *   closure.
 * - `--fixture <path>`: read a saved audit JSON instead of spawning pnpm.
 * - `--packages <a,b>`: override the scanned closure (test mode).
 *
 * Fail-closed: a spawn failure, an unparseable payload, or an empty scan exits
 * 1 with a named error. A gate that cannot see the graph never reports success.
 */

import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import {
  DEFAULT_AUDIT_LEVEL,
  collectBundledPackages,
  evaluateBundledAudit,
  expandRuntimeClosure,
  formatBundledAuditFailure,
} from './lib/bundledAudit.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/** Bundled surfaces: source root plus the Vite config that builds it. */
const BUNDLED_SURFACES = Object.freeze([
  { sourceDir: 'src/main', config: 'vite.main.config.mts' },
  { sourceDir: 'src/preload', config: 'vite.preload.config.mts' },
]);

const NODE_BUILTINS = new Set(builtinModules);

function walkSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (/\.(ts|mts)$/u.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `rollupOptions.external` from a real, evaluated Vite config. Throws
 * (fail-closed) when the config cannot be resolved — guessing the external
 * list would change what this gate audits.
 *
 * @param {string} configFile
 * @returns {Promise<string[]>}
 */
async function resolveExternals(configFile) {
  const imported = await import(path.join(repoRoot, configFile));
  const exported = imported.default;
  const config =
    typeof exported === 'function'
      ? await exported({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false })
      : exported;
  const external = config?.build?.rollupOptions?.external;
  if (!Array.isArray(external)) {
    throw new Error(
      `${configFile} does not declare an array rollupOptions.external; cannot determine what the bundle inlines.`
    );
  }
  return external.filter((entry) => typeof entry === 'string');
}

/**
 * Runtime dependencies of an installed package: `dependencies` plus every
 * non-optional `peerDependencies` entry. Peers matter — `@hono/node-server`
 * declares `hono` as a peer, and that is how the desktop local MCP server's
 * HTTP layer reaches the bundle. Returns [] for a package we cannot resolve:
 * a name that is not installed cannot be in the bundle either.
 *
 * @param {string} name
 * @returns {string[]}
 */
function readInstalledDependencies(name) {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'node_modules', name, 'package.json'), 'utf8')
    );
    const peerMeta = manifest.peerDependenciesMeta ?? {};
    const peers = Object.keys(manifest.peerDependencies ?? {}).filter(
      (peer) => peerMeta[peer]?.optional !== true
    );
    return [...Object.keys(manifest.dependencies ?? {}), ...peers];
  } catch {
    return [];
  }
}

/**
 * The package closure the desktop bundles inline, scanned from source.
 *
 * @returns {Promise<string[]>}
 */
export async function scanBundledClosure() {
  const roots = new Set();
  for (const surface of BUNDLED_SURFACES) {
    const externals = await resolveExternals(surface.config);
    const files = walkSourceFiles(path.join(repoRoot, surface.sourceDir));
    const sources = files.map((file) => readFileSync(file, 'utf8'));
    for (const name of collectBundledPackages({ sources, externals })) {
      if (NODE_BUILTINS.has(name)) continue;
      roots.add(name);
    }
  }
  return expandRuntimeClosure(roots, readInstalledDependencies);
}

/**
 * Run the FULL `pnpm audit --json`. pnpm exits non-zero when advisories exist
 * but still prints the payload, so stdout is captured on every exit code.
 *
 * @returns {string}
 */
function runPnpmAudit() {
  const configuredTimeout = Number(process.env.LINGUA_BUNDLED_AUDIT_TIMEOUT_MS);
  const timeout =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120_000;
  const result = spawnSync('pnpm', ['audit', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout,
  });
  if (result.error) {
    throw new Error(`Could not run pnpm audit: ${result.error.message}`);
  }
  if (!result.stdout || result.stdout.trim().length === 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new Error(
      `pnpm audit produced no JSON output (exit ${result.status}).${stderr ? ` stderr: ${stderr}` : ''}`
    );
  }
  return result.stdout;
}

function printHelp() {
  console.log(`Usage: node scripts/assert-bundled-audit.mjs [options]

Fails closed when a dependency inlined into the packaged desktop main/preload
bundle carries an advisory at or above the threshold. Complements
check:prod-audit, which only sees package.json "dependencies".

Options:
  --level <severity>   Block at/above this severity. Default: ${DEFAULT_AUDIT_LEVEL}
                       (one of: info, low, moderate, high, critical)
  --fixture <path>     Read audit JSON from a file instead of running pnpm
                       (test mode). Production runs omit this.
  --packages <a,b>     Override the scanned bundled closure (test mode).
  --list               Print the scanned closure and exit without auditing.
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      level: { type: 'string' },
      fixture: { type: 'string' },
      packages: { type: 'string' },
      list: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const level = values.level ?? DEFAULT_AUDIT_LEVEL;

  const closure = values.packages
    ? values.packages
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : await scanBundledClosure();

  if (values.list) {
    console.log(closure.join('\n'));
    return 0;
  }

  const rawJson = values.fixture
    ? await readFile(path.resolve(values.fixture), 'utf8')
    : runPnpmAudit();

  let audit;
  try {
    audit = JSON.parse(rawJson);
  } catch (error) {
    console.error(
      `bundled-audit: could not parse audit JSON: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }

  const result = evaluateBundledAudit(audit, closure, { level });

  if (result.error === 'malformed') {
    console.error(`bundled-audit: ${result.message}`);
    return 1;
  }

  if (!result.ok) {
    console.error(formatBundledAuditFailure(result));
    return 1;
  }

  console.log(
    `bundled-audit: ok (${result.audited.length} bundled package(s) inlined into main/preload; 0 advisories at or above ${result.level})`
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
