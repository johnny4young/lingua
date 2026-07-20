/**
 * Educational-email validation for implementation
 *
 * Phase 1 strategy per LICENSING_ADR Decision 5: cheap regex
 * gate on `.edu` plus an explicit allow-list of additional
 * educational TLDs commonly used outside the US (`.ac.uk`,
 * `.edu.mx`, etc.). Maintainer extends `ADDITIONAL_EDUCATIONAL_TLDS`
 * as new institutions surface; the regex stays tight.
 *
 * Phase 2 enhancement (BACKLOG): GitHub Education API integration
 * for stronger verification. OAuth flow is non-trivial and would
 * gate a standalone change on its own.
 *
 * Anti-spoof note: a `.edu` regex catches the obvious case but not
 * a determined attacker. The schema-level UNIQUE(email) +
 * UNIQUE(device_id) on `educations` plus the per-IP KV rate limit
 * are the real anti-abuse gates. The regex is a friction layer
 * that filters honest mistakes and casual abuse.
 */

/**
 * Hard regex: `<local>@<...>.edu`. Allows multi-level subdomains
 * common in university email setups (e.g. `me@cs.stanford.edu`).
 * Case-insensitive and trims handled by callers.
 */
const EDU_TLD_REGEX = /^[^@\s]+@([a-z0-9-]+\.)*edu$/i;

/**
 * Additional TLDs the maintainer has explicitly approved as
 * educational. Update here as new institutions request access.
 * Keep entries lowercase. Each entry MUST be the full TLD shape
 * the email ends with (so `ac.uk` matches `me@oxford.ac.uk` but
 * NOT `me@uk`).
 */
const ADDITIONAL_EDUCATIONAL_TLDS: readonly string[] = [
  // United Kingdom university convention.
  'ac.uk',
  // Mexico — UNAM, ITESM, etc.
  'edu.mx',
  // Australia — most universities use this convention.
  'edu.au',
  // Canada — universities mix with `.ca`, but the explicit `.edu.ca` minority case.
  'edu.ca',
  // Brazil.
  'edu.br',
  // India — the IIT family uses this.
  'ac.in',
];

export interface EducationalEmailResult {
  ok: boolean;
  /** The matched suffix (e.g. `edu`, `ac.uk`) for diagnostics. Undefined when ok is false. */
  matched?: string;
}

/**
 * Validate that an email is plausibly educational.
 *
 *   isEducationalEmail('me@stanford.edu')      // { ok: true, matched: 'edu' }
 *   isEducationalEmail('me@oxford.ac.uk')      // { ok: true, matched: 'ac.uk' }
 *   isEducationalEmail('me@gmail.com')         // { ok: false }
 *   isEducationalEmail('not-an-email')         // { ok: false }
 */
export function isEducationalEmail(email: string): EducationalEmailResult {
  if (typeof email !== 'string') return { ok: false };
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0) return { ok: false };

  if (EDU_TLD_REGEX.test(trimmed)) return { ok: true, matched: 'edu' };

  for (const tld of ADDITIONAL_EDUCATIONAL_TLDS) {
    // Match `<local>@<anything>.<tld>` — require at least one
    // domain segment before the TLD so `me@ac.uk` doesn't pass
    // (real schools have a subdomain).
    const pattern = new RegExp(
      `^[^@\\s]+@([a-z0-9-]+\\.)+${tld.replace(/\./g, '\\.')}$`,
      'i'
    );
    if (pattern.test(trimmed)) return { ok: true, matched: tld };
  }

  return { ok: false };
}

/**
 * Exported for tests that pin the allow-list shape.
 */
export const _ADDITIONAL_EDUCATIONAL_TLDS_FOR_TEST = ADDITIONAL_EDUCATIONAL_TLDS;
