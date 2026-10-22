/**
 * A workspace can put its own rows ahead of files in Quick Open while it is
 * on screen; the SQL tab lists tables, views, functions and saved queries.
 * Rows arrive translated and carry their actions, so Quick Open stays
 * unaware of the workspace and its code stays out of the boot bundle.
 */

export interface QuickOpenScopeItem {
  id: string;
  /** Kind badge, such as TABLE or QUERY. */
  badge: string;
  name: string;
  /** Where the row comes from: a connection name, Local, a saved folder. */
  detail: string;
  /** Enter. */
  open: () => void;
  /** Cmd/Ctrl+Enter; Enter's action when unset. */
  structure?: () => void;
  /** Alt+Enter; Enter's action when unset. */
  insert?: () => void;
}

export interface QuickOpenScope {
  title: string;
  /** Footer hints, glyph first: `['↵', 'open data']`. */
  legend: ReadonlyArray<readonly [string, string]>;
  /** Footer note after the hints. */
  note?: string;
  items: () => QuickOpenScopeItem[];
}

let current: QuickOpenScope | null = null;

/** Registers the scope of the workspace on screen; the returned function removes it. */
export function setQuickOpenScope(scope: QuickOpenScope): () => void {
  current = scope;
  return () => {
    if (current === scope) current = null;
  };
}

export const getQuickOpenScope = (): QuickOpenScope | null => current;

/** Every term of the query appears in the name or the detail. */
export function matchesQuickOpenTerms(query: string, ...fields: string[]): boolean {
  const haystack = fields.join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}
