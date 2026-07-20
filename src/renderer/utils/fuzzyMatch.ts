/**
 * Lightweight fuzzy matcher for catalog-style filtering surfaces.
 *
 * implementation — replaces the substring-only filter at
 * `DeveloperUtilitiesModal.tsx` so users can type `b64` and find Base64,
 * `ts` and find Timestamp, `md` and find Markdown Preview. Generic enough
 * to be reused by the command palette / quick open in future work.
 *
 * Scoring is intentionally simple and stable:
 *
 *   - Empty query returns null (callers treat null as "no match" and
 *     handle the all-pass case separately, identical to the prior
 *     substring filter).
 *   - Pure substring matches score highest (target.includes(query)).
 *     Token-prefix substring (the query starts a word inside the target)
 *     scores higher than mid-token substring.
 *   - Subsequence matches (every query char appears in order, possibly
 *     scattered) score lower than substring matches but still positive.
 *     Consecutive runs add a small bonus per consecutive char so
 *     "json" beats "j-s-o-n".
 *   - Both query and target are compared case-insensitively. Unicode is
 *     preserved as-is — no NFC normalization here, matches downstream
 *     i18n locale data which is already pre-normalised at write time.
 *
 * Returns a non-negative number when the query matches; null otherwise.
 * Higher scores = better matches; callers sort descending.
 */

export function fuzzyMatch(query: string, target: string): number | null {
  if (!query) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (!t) return null;

  // Substring fast-path — we cover the most common case directly so we
  // can score it higher than any subsequence match.
  const substringIndex = t.indexOf(q);
  if (substringIndex !== -1) {
    // Token-prefix bonus: substring at the start, or right after a
    // separator (space, hyphen, slash, dot) counts as a stronger match.
    const isTokenPrefix =
      substringIndex === 0 || /[\s\-_/.]/.test(t.charAt(substringIndex - 1));
    const lengthRatio = q.length / t.length; // longer query / target ratio favours tighter matches
    const base = 1000;
    return base + (isTokenPrefix ? 500 : 0) + Math.round(lengthRatio * 200);
  }

  // Subsequence walk — every char of q must appear in t in order.
  let qi = 0;
  let consecutiveRun = 0;
  let bestRun = 0;
  let charsMatched = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t.charAt(ti) === q.charAt(qi)) {
      qi += 1;
      consecutiveRun += 1;
      charsMatched += 1;
      if (consecutiveRun > bestRun) bestRun = consecutiveRun;
    } else {
      consecutiveRun = 0;
    }
  }

  if (qi < q.length) return null;

  // Subsequence score caps below 1000 so substring matches always win.
  // Best-run gives a meaningful bump so consecutive sub-strings in the
  // target rank above scattered hits with the same character count.
  return charsMatched * 10 + bestRun * 5;
}
