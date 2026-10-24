/** Escape a user string for use as a literal in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` on every (case-insensitive) occurrence of `query`,
 * returning alternating non-match / match segments so the renderer can
 * wrap matches in a highlight `<mark>`. Returns a single non-match
 * segment when the query is empty or never matches.
 */
export function splitForHighlight(
  text: string,
  query: string
): Array<{ text: string; match: boolean }> {
  if (query.length === 0) return [{ text, match: false }];
  const re = new RegExp(escapeRegExp(query), 'gi');
  const segments: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, m.index), match: false });
    }
    segments.push({ text: m[0], match: true });
    lastIndex = m.index + m[0].length;
    // Guard against zero-length matches (escaped query never produces
    // one, but be defensive against an infinite loop).
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), match: false });
  }
  return segments;
}
