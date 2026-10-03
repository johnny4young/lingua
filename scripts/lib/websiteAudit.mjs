/**
 * Website production audit gate, pure logic.
 *
 * Judges an `npm audit --json` payload for website/package-lock.json. It fails
 * closed like scripts/lib/prodAudit.mjs, with one addition: a reviewed
 * exception may excuse a specific advisory on a specific package until it
 * expires. Exceptions exist only for advisories with no patched release.
 */

import { DEFAULT_AUDIT_LEVEL, SEVERITY_RANK } from './prodAudit.mjs';

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** GHSA id from an advisory URL such as https://github.com/advisories/GHSA-xxxx. */
function advisoryId(url) {
  return typeof url === 'string' ? (/GHSA-[\w-]+$/u.exec(url)?.[0] ?? null) : null;
}

/** Root advisories behind a vulnerability, following `via` package references. */
function rootAdvisories(vulnerabilities, name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const entry = vulnerabilities[name];
  if (!isPlainRecord(entry) || !Array.isArray(entry.via)) return [];
  return entry.via.flatMap(via =>
    typeof via === 'string'
      ? rootAdvisories(vulnerabilities, via, seen)
      : isPlainRecord(via)
        ? [{ id: advisoryId(via.url), package: via.name, severity: via.severity, url: via.url }]
        : []
  );
}

/**
 * @param {unknown} audit Parsed `npm audit --json` payload.
 * @param {{ level?: string, exceptions?: Array<{ id: string, package: string, expires: string }>, now?: Date }} options
 */
export function evaluateWebsiteAudit(audit, options = {}) {
  const level = options.level ?? DEFAULT_AUDIT_LEVEL;
  const now = options.now ?? new Date();
  const threshold = SEVERITY_RANK[level];
  if (threshold === undefined) {
    return { ok: false, error: `unknown audit level ${level}`, offending: [], excused: [], expired: [] };
  }
  if (!isPlainRecord(audit) || !isPlainRecord(audit.vulnerabilities)) {
    return { ok: false, error: 'malformed npm audit payload', offending: [], excused: [], expired: [] };
  }

  const exceptions = options.exceptions ?? [];
  const expired = exceptions.filter(item => !(new Date(`${item.expires}T23:59:59Z`) >= now));
  const active = exceptions.filter(item => !expired.includes(item));
  const isExcused = advisory =>
    advisory.id !== null &&
    active.some(item => item.id === advisory.id && item.package === advisory.package);

  const offending = [];
  const excused = [];
  for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
    if (!isPlainRecord(entry) || (SEVERITY_RANK[entry.severity] ?? Infinity) < threshold) continue;
    const blocking = rootAdvisories(audit.vulnerabilities, name).filter(
      advisory => (SEVERITY_RANK[advisory.severity] ?? Infinity) >= threshold
    );
    const unexcused = blocking.filter(advisory => !isExcused(advisory));
    if (blocking.length > 0 && unexcused.length === 0) {
      excused.push({ name, advisories: blocking.map(advisory => advisory.id) });
    } else {
      offending.push({
        name,
        severity: entry.severity,
        advisories: (unexcused.length > 0 ? unexcused : blocking).map(advisory => advisory.url ?? advisory.id),
      });
    }
  }
  return {
    ok: offending.length === 0,
    error: null,
    offending,
    excused,
    expired: expired.map(item => item.id),
  };
}
