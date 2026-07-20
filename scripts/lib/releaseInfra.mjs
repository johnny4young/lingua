/**
 * Release infra-readiness — pure logic.
 *
 * The web build fetches the Ruby + DuckDB WebAssembly runtimes from the R2
 * store at `R2_PUBLIC_BASE/web-runtime/<lib>/<version>/<file>`, and the
 * deploy-web job fails closed at the END of a release if those
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
 * Web-runtime WASM assets the standalone web build pulls from R2.
 * `pkg` is the installed package whose `version` pins the runtime path, matching
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
 * Does a Cloudflare `cf-mitigated` response header mean the request was
 * challenged/blocked at the edge (managed challenge, free Bot Fight Mode, …)?
 * Any non-empty value means Cloudflare mitigated the request BEFORE it reached
 * R2 — so it is NOT a CORS / public-access problem. Free Bot Fight Mode
 * managed-challenges datacenter-ASN traffic (e.g. the GitHub Actions runner)
 * and cannot be exempted by WAF skip rules; that is exactly how the v0.7.0 web
 * deploy was blocked, while the generic "configure CORS" message sent the
 * operator down the wrong path. Detecting it here lets the early `infra-readiness`
 * CI job (which runs from a challenged runner IP) name the real cause.
 *
 * @param {string | null | undefined} cfMitigated
 * @returns {boolean}
 */
export function isCloudflareChallenge(cfMitigated) {
  return typeof cfMitigated === 'string' && cfMitigated.trim() !== '';
}

/**
 * @typedef {object} InfraProbeInput
 * @property {string} url            The probed public URL.
 * @property {'runtime-asset'} kind
 * @property {number | null} status  HTTP status, or null for a network error.
 * @property {string | null} acao    The `access-control-allow-origin` header.
 * @property {string | null} [cfMitigated]  The `cf-mitigated` header, set when
 *   Cloudflare challenges/blocks the request at the edge (bot mitigation).
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
 * - Cloudflare challenge (`cf-mitigated` set) → fail, but with a distinct
 *   "bot mitigation, not CORS" cause + fix (the second v0.7.0 break).
 * - 403 → fail (bucket public access / CORS not configured — the actual break).
 * - 200 but no app-origin CORS → fail (reachable but the browser would block it).
 * - 404 on a versioned runtime asset → warn (a version bump not yet uploaded;
 *   the deploy job uploads it — but it cannot prove CORS until then).
 * - network error / other status → fail.
 *
 * @param {InfraProbeInput} input
 * @returns {InfraProbeResult}
 */
export function classifyInfraProbe({ url, kind, status, acao, cfMitigated }) {
  // Edge mitigation (managed challenge / free Bot Fight Mode) blocks the request
  // before it reaches R2 — NOT a CORS or public-access misconfiguration. Surface
  // the real cause + fix instead of the misleading "configure CORS" message.
  if (isCloudflareChallenge(cfMitigated)) {
    return {
      url,
      level: 'fail',
      detail: `blocked by Cloudflare bot mitigation (cf-mitigated: ${String(cfMitigated).trim()}), not a CORS problem — disable Bot Fight Mode for this host (Cloudflare → Security → Bots) or exclude it; see docs/runbooks/r2-web-runtime-setup.md`,
    };
  }
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
      detail:
        'HTTP 403 — bucket public access / CORS not configured (see docs/runbooks/r2-web-runtime-setup.md)',
    };
  }
  if (status === 404 && kind === 'runtime-asset') {
    return {
      url,
      level: 'warn',
      detail:
        'HTTP 404 — not yet uploaded for this version; the deploy job will upload it (CORS unverified until then)',
    };
  }
  if (status === null) {
    return { url, level: 'fail', detail: 'unreachable (network error / DNS / TLS)' };
  }
  return { url, level: 'fail', detail: `unexpected HTTP ${status}` };
}

/**
 * implementation note probes into a pass/fail verdict. A missing `R2_PUBLIC_BASE`
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
      configError: 'R2_PUBLIC_BASE is not set; cannot probe the public web-runtime store.',
    };
  }
  const failures = probes.filter(probe => probe.level === 'fail');
  const warnings = probes.filter(probe => probe.level === 'warn');
  return { ok: failures.length === 0, failures, warnings, configError: null };
}
