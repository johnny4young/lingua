/**
 * RL-145 — production-dependency audit gate, pure logic.
 *
 * Before RL-145, `pnpm audit --prod --audit-level high` blocked RELEASES (the
 * `release.yml` security-audit job, from RL-080), but PR CI only ran the full
 * audit as advisory (`continue-on-error`). A prod high-severity dep could land
 * on a PR with nothing but a warning. This module is the testable core of the
 * shared PR + release gate: it takes the parsed `pnpm audit --json` payload and
 * decides pass/fail against a severity threshold, with no I/O so the "synthetic
 * high advisory fails CI" acceptance criterion can be proven with a fixture
 * instead of a live registry advisory (which cannot be injected).
 *
 * The full (dev-inclusive) audit deliberately stays ADVISORY elsewhere: the
 * esbuild / tar highs are reached only through dev tooling (vite,
 * electron-forge) and are unfixable without forge upgrades. This gate only
 * judges the PRODUCTION graph — callers feed it `pnpm audit --prod --json`.
 *
 * Mirrors the pure-lib + CLI + fixture-test shape of
 * `scripts/lib/licenseKeyRotation.mjs` and `scripts/lib/darwinAsset.mjs`.
 */

/**
 * Severity ordering used to compare an advisory against the gate threshold.
 * Matches the npm/pnpm audit severity vocabulary. Higher rank = more severe.
 */
export const SEVERITY_RANK = Object.freeze({
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
});

/** Default threshold: block on `high` and `critical` (AUDIT-25 baseline). */
export const DEFAULT_AUDIT_LEVEL = 'high';
const AUDIT_SEVERITIES = Object.freeze(Object.keys(SEVERITY_RANK));

function isAuditSeverity(value) {
  return typeof value === 'string' && Object.hasOwn(SEVERITY_RANK, value);
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptySeverityCounts() {
  return { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
}

function malformedAuditResult(level, message, counts = emptySeverityCounts()) {
  return { ok: false, error: 'malformed', level, offending: [], counts, message };
}

function readMetadataCounts(audit) {
  const counts = emptySeverityCounts();
  const vulnerabilities = isPlainRecord(audit.metadata)
    ? audit.metadata.vulnerabilities
    : undefined;
  if (!isPlainRecord(vulnerabilities)) return null;
  for (const severity of AUDIT_SEVERITIES) {
    const value = vulnerabilities[severity];
    if (Number.isFinite(value)) counts[severity] = value;
  }
  return counts;
}

/**
 * @typedef {Object} OffendingAdvisory
 * @property {string} id pnpm/npm advisory id (object key in the audit payload).
 * @property {string} module Vulnerable package name (`module_name`).
 * @property {string} severity Advisory severity (`info`|`low`|`moderate`|`high`|`critical`).
 * @property {string} title Human-readable advisory title.
 * @property {string} url Advisory URL for the remediation hint.
 * @property {string | null} shortestPath Shortest dependency path to the module, for `pnpm why`.
 */

/**
 * @typedef {Object} ProdAuditResult
 * @property {boolean} ok True when no advisory meets/exceeds the threshold AND the payload parsed.
 * @property {string | null} error Named failure when the payload is unusable (`malformed`); null on a clean read.
 * @property {string} level The threshold applied.
 * @property {OffendingAdvisory[]} offending Advisories at/above the threshold, severity-sorted (worst first).
 * @property {{info:number,low:number,moderate:number,high:number,critical:number}} counts Per-severity totals.
 */

/**
 * Shortest dependency path across an advisory's findings, e.g.
 * `.>@electron-forge/cli>…>tar`. Used by the CLI remediation hint so a red
 * gate tells you exactly which dependency chain to cut. Returns null when the
 * payload carries no usable paths.
 *
 * @param {{ paths?: string[] }[] | undefined} findings
 * @returns {string | null}
 */
function shortestFindingPath(findings) {
  if (!Array.isArray(findings)) return null;
  let shortest = null;
  for (const finding of findings) {
    if (!finding || !Array.isArray(finding.paths)) continue;
    for (const path of finding.paths) {
      if (typeof path !== 'string') continue;
      if (shortest === null || path.length < shortest.length) shortest = path;
    }
  }
  return shortest;
}

/**
 * Evaluate a parsed `pnpm audit --json` payload against a severity threshold.
 * Pure — no I/O, no process exit. Fail-closed on a malformed payload: a
 * missing/!object `advisories` map yields `{ ok:false, error:'malformed' }`
 * so the CLI refuses to pass when it cannot actually read the audit, rather
 * than silently green-lighting an unverifiable graph.
 *
 * @param {unknown} audit Parsed JSON from `pnpm audit --prod --json`.
 * @param {{ level?: string }} [options]
 * @returns {ProdAuditResult}
 */
export function evaluateProdAudit(audit, { level = DEFAULT_AUDIT_LEVEL } = {}) {
  const threshold = SEVERITY_RANK[level];

  if (threshold === undefined) {
    return malformedAuditResult(
      level,
      `Unknown audit level "${level}". Use one of: ${AUDIT_SEVERITIES.join(', ')}.`
    );
  }

  if (!isPlainRecord(audit) || !isPlainRecord(audit.advisories)) {
    return malformedAuditResult(
      level,
      'Audit payload has no advisories object; cannot verify the production graph.'
    );
  }

  const offending = [];
  // Prefer the payload's own metadata counts (authoritative for the full
  // graph pnpm scanned); fall back to deriving from the advisories map.
  const metadataCounts = readMetadataCounts(audit);
  const counts = metadataCounts ?? emptySeverityCounts();
  const deriveCounts = metadataCounts === null;

  for (const [id, advisory] of Object.entries(audit.advisories)) {
    if (!isPlainRecord(advisory)) {
      return malformedAuditResult(
        level,
        `Audit advisory ${id} is not an object; cannot verify the production graph.`,
        counts
      );
    }
    const { severity } = advisory;
    if (!isAuditSeverity(severity)) {
      return malformedAuditResult(
        level,
        `Audit advisory ${id} has unknown severity ${JSON.stringify(severity)}; cannot verify the production graph.`,
        counts
      );
    }
    if (deriveCounts) counts[severity] += 1;
    const rank = SEVERITY_RANK[severity];
    if (rank >= threshold) {
      offending.push({
        id,
        module: typeof advisory.module_name === 'string' ? advisory.module_name : 'unknown',
        severity,
        title: typeof advisory.title === 'string' ? advisory.title : '',
        url: typeof advisory.url === 'string' ? advisory.url : '',
        shortestPath: shortestFindingPath(advisory.findings),
      });
    }
  }

  offending.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));

  return { ok: offending.length === 0, error: null, level, offending, counts };
}

/**
 * Build the human-facing failure report for the CLI (fold C — remediation
 * hint). One block per offending advisory: id, module, severity, title, the
 * advisory URL, the shortest dependency path, and the exact `pnpm why`
 * command to trace it. Returns an empty string when nothing offends.
 *
 * @param {ProdAuditResult} result
 * @returns {string}
 */
export function formatProdAuditFailure(result) {
  if (result.offending.length === 0) return '';
  const lines = [
    `Production dependency audit found ${result.offending.length} advisory(ies) at or above "${result.level}":`,
  ];
  for (const adv of result.offending) {
    lines.push('');
    lines.push(`  [${adv.severity}] ${adv.module} — ${adv.title || adv.id}`);
    if (adv.url) lines.push(`    ${adv.url}`);
    if (adv.shortestPath) lines.push(`    path: ${adv.shortestPath}`);
    lines.push(`    trace: pnpm why ${adv.module}`);
  }
  lines.push('');
  lines.push(
    'Fix: upgrade or override the offending production dependency, or document a vendored exception per docs/RELEASE_SECURITY.md before merging.'
  );
  return lines.join('\n');
}
