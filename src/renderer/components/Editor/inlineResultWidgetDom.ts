/**
 * Cheap type inference over the displayed string. Mirrors the
 * heuristic used in the Stdin queue + Variables card. We can't know
 * the runtime type without re-parsing the host language; this fallback
 * is good enough to colour the type pill consistently.
 */
export function inferKind(raw: string | undefined): string {
  if (raw === undefined || raw === '') return 'string';
  const s = raw.trim();
  if (s === 'true' || s === 'false') return 'boolean';
  if (s === 'undefined') return 'undefined';
  if (s === 'null') return 'null';
  if (/^-?\d+(\.\d+)?$/.test(s)) return 'number';
  if (s.startsWith('[') && s.endsWith(']')) return 'array';
  if (s.startsWith('{') && s.endsWith('}')) return 'object';
  if (s.startsWith('"') || s.startsWith("'")) return 'string';
  return 'string';
}

/**
 * The overlay shell for one line's answers. Monaco re-uses overlay nodes
 * across layouts, so the shell is plain DOM and the answers portal into it.
 */
export function createInlineResultNode(line: number): HTMLElement {
  const root = document.createElement('span');
  root.className = 'lingua-inline-result';
  root.setAttribute('data-testid', 'lingua-inline-result');
  root.setAttribute('data-line', String(line));
  return root;
}
