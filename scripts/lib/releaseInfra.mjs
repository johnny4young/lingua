/**
 * Release infra-readiness — pure logic.
 *
 * The web build fetches the Ruby + DuckDB WebAssembly runtimes from the R2
 * mirror at `R2_PUBLIC_BASE/web-runtime/<lib>/<version>/<file>`, and the
 * deploy-web + mirror-r2 jobs fail closed at the END of a release if those
 * objects are not publicly readable with a CORS header for the web app origin.
 * That is exactly how the v0.7.0 release broke (HTTP 403, "missing
 * Access-Control-Allow-Origin"): the bucket public-access / CORS policy was
 * not configured, but the check only ran AFTER the macOS build + the GitHub
 * Release publish.
 *
 * This module is the pure half of `scripts/check-release-infra.mjs`, a probe
 * that hits the PUBLIC base URL (no secret needed) so the same failure surfaces
 * in seconds — before any build, locally via `release:preflight` and early in
 * the release workflow. Pure logic + tests: `tests/scripts/releaseInfra.test.ts`.
 */

/** The web app origin the runtime assets must allow via CORS. */
export const APP_ORIGIN = 'https://app.linguacode.dev';

/**
 * Web-runtime WASM assets the standalone web build pulls from the R2 mirror.
 * `pkg` is the installed package whose `version` pins the mirror path, mirroring
 * the `Upload oversized web runtime assets to R2` step in `deploy-web.yml`.
 *
 * @type {ReadonlyArray<{ lib: string, pkg: string, file: string }>}
 */
export const WEB_RUNTIME_ASSETS = [
  { lib: 'duckdb', pkg: '@duckdb/duckdb-wasm', file: 'duckdb-mvp.wasm' },
  { lib: 'ruby', pkg: '@ruby/3.4-wasm-wasi', file: 'ruby+stdlib.wasm' },
];

/** Join the public base + the versioned web-runtime key (no double slash). */
export function buildRuntimeAssetUrl(publicBase, { lib, version, file }) {
  const base = String(publicBase).replace(/\/+$/u, '');
  return `${base}/web-runtime/${lib}/${version}/${file}`;
}

/**
 * Does an `Access-Control-Allow-Origin` value permit {@link APP_ORIGIN}?
 * Accepts the wildcard or an exact origin match (trimmed), nothing else.
 *
 * @param {string | null | undefined} header
 * @returns {boolean}
 */
export function corsHeaderAllowsAppOrigin(header) {
  if (typeof header !== 'string') return false;
  const value = header.trim();
  return value === '*' || value === APP_ORIGIN;
}

/**
 * @typedef {object} InfraProbeInput
 * @property {string} url            The probed public URL.
 * @property {'runtime-asset' | 'sentinel'} kind
 * @property {number | null} status  HTTP status, or null for a network error.
 * @property {string | null} acao    The `access-control-allow-origin` header.
 */

/**
 * @typedef {object} InfraProbeResult
 * @property {string} url
 * @property {'ok' | 'warn' | 'fail'} level
 * @property {string} detail
 */

/**
 * Classify a single probe into ok / warn / fail. This is where the v0.7.0
 * failure modes are encoded:
 * - 403 → fail (bucket public access / CORS not configured — the actual break).
 * - 200 but no app-origin CORS → fail (reachable but the browser would block it).
 * - 404 on a versioned runtime asset → warn (a version bump not yet mirrored;
 *   the deploy job uploads it — but it cannot prove CORS until then).
 * - 404 on the sentinel → fail (the mirror was never initialized).
 * - network error / other status → fail.
 *
 * @param {InfraProbeInput} input
 * @returns {InfraProbeResult}
 */
export function classifyInfraProbe({ url, kind, status, acao }) {
  if (status === 200) {
    if (corsHeaderAllowsAppOrigin(acao)) {
      return { url, level: 'ok', detail: 'reachable with app-origin CORS' };
    }
    return {
      url,
      level: 'fail',
      detail: `reachable (HTTP 200) but missing Access-Control-Allow-Origin for ${APP_ORIGIN}`,
    };
  }
  if (status === 403) {
    return {
      url,
      level: 'fail',
      detail: 'HTTP 403 — bucket public access / CORS not configured (see docs/runbooks/r2-release-mirror-setup.md)',
    };
  }
  if (status === 404) {
    if (kind === 'runtime-asset') {
      return {
        url,
        level: 'warn',
        detail: 'HTTP 404 — not yet mirrored for this version; the deploy job will upload it (CORS unverified until then)',
      };
    }
    return { url, level: 'fail', detail: 'HTTP 404 — sentinel missing; the R2 mirror was never initialized' };
  }
  if (status === null) {
    return { url, level: 'fail', detail: 'unreachable (network error / DNS / TLS)' };
  }
  return { url, level: 'fail', detail: `unexpected HTTP ${status}` };
}

/**
 * Fold classified probes into a pass/fail verdict. A missing `R2_PUBLIC_BASE`
 * is itself a hard failure (the release cannot validate the surface the web
 * build depends on).
 *
 * @param {{ publicBaseConfigured: boolean, probes: InfraProbeResult[] }} input
 * @returns {{ ok: boolean, failures: InfraProbeResult[], warnings: InfraProbeResult[], configError: string | null }}
 */
export function summarizeInfraReadiness({ publicBaseConfigured, probes }) {
  if (!publicBaseConfigured) {
    return {
      ok: false,
      failures: [],
      warnings: [],
      configError: 'R2_PUBLIC_BASE is not set; cannot probe the public web-runtime mirror.',
    };
  }
  const failures = probes.filter((probe) => probe.level === 'fail');
  const warnings = probes.filter((probe) => probe.level === 'warn');
  return { ok: failures.length === 0, failures, warnings, configError: null };
}
