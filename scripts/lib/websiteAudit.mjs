/**
 * Website production audit gate, pure logic.
 *
 * Judges an `npm audit --json` payload for website/package-lock.json. It fails
 * closed like scripts/lib/prodAudit.mjs, with one addition: a reviewed
 * exception may excuse a specific advisory on a specific package until it
 * expires. Exceptions exist only for advisories with no patched release.
 */

import { DEFAULT_AUDIT_LEVEL, SEVERITY_RANK } from './prodAudit.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Longest review window an exception may carry, counted from the start of its
 * reviewed day to the end of its expiry day. A longer window would let an
 * entry excuse an advisory indefinitely without anyone looking at it again.
 */
export const MAX_EXCEPTION_DAYS = 90;

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** GHSA id from an advisory URL such as https://github.com/advisories/GHSA-xxxx. */
function advisoryId(url) {
  return typeof url === 'string'
    ? (/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/u.exec(
        url
      )?.[1] ?? null)
    : null;
}

function isSeverity(value) {
  return typeof value === 'string' && Object.hasOwn(SEVERITY_RANK, value);
}

function failure(error) {
  return { ok: false, error, offending: [], excused: [], expired: [], unused: [] };
}

/** Start of a real UTC calendar day written as YYYY-MM-DD, or NaN. */
function dayStart(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return NaN;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return NaN;
  return date.getTime();
}

/** Final millisecond of a YYYY-MM-DD UTC day, or NaN. */
function expiryTime(value) {
  return dayStart(value) + DAY_MS - 1;
}

/**
 * Why an exception entry is unusable, or null when it is well formed. Every
 * entry must name one GHSA advisory and one package, carry a non-empty reason,
 * and have been reviewed on a past or current day with an expiry no more than
 * MAX_EXCEPTION_DAYS after that review.
 */
function exceptionProblem(item, now) {
  if (!isPlainRecord(item)) return 'is not an object';
  if (
    typeof item.id !== 'string' ||
    advisoryId(`https://github.com/advisories/${item.id}`) !== item.id
  ) {
    return 'needs a GHSA id';
  }
  const label = item.id;
  if (typeof item.package !== 'string' || !item.package) return `${label} needs a package`;
  if (typeof item.reason !== 'string' || !item.reason.trim()) return `${label} needs a reason`;
  const reviewed = dayStart(item.reviewed);
  if (!Number.isFinite(reviewed)) return `${label} needs a reviewed YYYY-MM-DD date`;
  if (reviewed > now.getTime()) return `${label} has a reviewed date in the future`;
  const expires = expiryTime(item.expires);
  if (!Number.isFinite(expires)) return `${label} needs an expires YYYY-MM-DD date`;
  if (expires < reviewed) return `${label} expires before it was reviewed`;
  if (expires - reviewed + 1 > MAX_EXCEPTION_DAYS * DAY_MS) {
    return `${label} expires more than ${MAX_EXCEPTION_DAYS} days after its review`;
  }
  return null;
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
 * @param {{ level?: string, exceptions?: Array<{ id: string, package: string, reviewed: string, expires: string, reason: string }>, now?: Date }} options
 */
export function evaluateWebsiteAudit(audit, options = {}) {
  const level = options.level ?? DEFAULT_AUDIT_LEVEL;
  const now = options.now ?? new Date();
  if (!isSeverity(level)) return failure(`unknown audit level ${level}`);
  const threshold = SEVERITY_RANK[level];
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    return failure('invalid audit date');
  if (
    !isPlainRecord(audit) ||
    Object.hasOwn(audit, 'error') ||
    !isPlainRecord(audit.vulnerabilities)
  ) {
    return failure('malformed npm audit payload');
  }

  // Validate the whole graph before applying exceptions. Dropping an unreadable
  // entry or missing reference could make a partial audit appear fully excused.
  for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
    if (!isPlainRecord(entry) || !isSeverity(entry.severity) || !Array.isArray(entry.via)) {
      return failure(`malformed npm audit vulnerability ${name}`);
    }
    for (const via of entry.via) {
      if (typeof via === 'string') {
        if (!Object.hasOwn(audit.vulnerabilities, via)) {
          return failure(`missing npm audit vulnerability ${via} referenced by ${name}`);
        }
      } else if (
        !isPlainRecord(via) ||
        typeof via.name !== 'string' ||
        !via.name ||
        !isSeverity(via.severity) ||
        typeof via.url !== 'string' ||
        !via.url
      ) {
        return failure(`malformed npm audit advisory in ${name}`);
      }
    }
  }

  const exceptions = options.exceptions ?? [];
  if (!Array.isArray(exceptions)) return failure('malformed website audit exceptions');
  for (const item of exceptions) {
    const problem = exceptionProblem(item, now);
    if (problem) return failure(`malformed website audit exceptions: ${problem}`);
  }
  const expired = exceptions.filter(item => expiryTime(item.expires) < now.getTime());
  const active = exceptions.filter(item => !expired.includes(item));
  const used = new Set();
  const isExcused = advisory => {
    if (advisory.id === null) return false;
    const match = active.find(item => item.id === advisory.id && item.package === advisory.package);
    if (match) used.add(match);
    return Boolean(match);
  };

  const offending = [];
  const excused = [];
  for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
    if (SEVERITY_RANK[entry.severity] < threshold) continue;
    const blocking = rootAdvisories(audit.vulnerabilities, name).filter(
      advisory => SEVERITY_RANK[advisory.severity] >= threshold
    );
    const unexcused = blocking.filter(advisory => !isExcused(advisory));
    if (blocking.length > 0 && unexcused.length === 0) {
      excused.push({ name, advisories: blocking.map(advisory => advisory.id) });
    } else {
      offending.push({
        name,
        severity: entry.severity,
        advisories: (unexcused.length > 0 ? unexcused : blocking).map(
          advisory => advisory.url ?? advisory.id
        ),
      });
    }
  }
  return {
    ok: offending.length === 0 && expired.length === 0,
    error: null,
    offending,
    excused,
    expired: expired.map(item => item.id),
    // Active entries that excused nothing: the advisory is gone or no longer
    // reaches the production graph. Reported, not fatal, so removal stays a
    // reviewed change rather than a surprise red build.
    unused: active.filter(item => !used.has(item)).map(item => item.id),
  };
}
