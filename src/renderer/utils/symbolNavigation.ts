/**
 * Helpers for extracting a flat, navigable symbol list from Monaco's
 * TypeScript worker output. Kept pure and side-effect-free so the flattening
 * rules can be unit-tested without spinning up Monaco.
 */

export interface NavigationTreeSpan {
  start: number;
  length: number;
}

/**
 * The worker includes additional metadata such as `kindModifiers` and
 * `nameSpan`; Go to Symbol only needs this shared subset.
 */
export interface NavigationTreeItem {
  text: string;
  kind: string;
  spans: NavigationTreeSpan[];
  childItems?: NavigationTreeItem[];
}

export interface SymbolEntry {
  /** Short name for the list row (e.g. `renderTree`). */
  name: string;
  /** Fully-qualified name for secondary text (e.g. `FileTree.renderTree`). */
  qualifiedName: string;
  /** TypeScript service kind string (`class`, `method`, `function`, `var`, …). */
  kind: string;
  /** 1-indexed Monaco line number pointing at the symbol's declaration. */
  line: number;
  /** 1-indexed Monaco column number. */
  column: number;
}

/**
 * Monaco's language IDs that expose symbols through `getNavigationTree`.
 */
export const SYMBOL_NAVIGATION_LANGUAGES = new Set(['javascript', 'typescript']);

export function supportsSymbolNavigation(languageId: string | null | undefined): boolean {
  if (!languageId) return false;
  return SYMBOL_NAVIGATION_LANGUAGES.has(languageId);
}

interface PositionResolver {
  (offset: number): { lineNumber: number; column: number };
}

/**
 * Walk the children of TS's declaration tree and convert character offsets to
 * Monaco line/column pairs. Deterministic in the order TS emits items so the
 * overlay preserves source order.
 */
function flattenNavigationItems(
  items: readonly NavigationTreeItem[] | undefined,
  resolvePosition: PositionResolver,
  parentPath = ''
): SymbolEntry[] {
  if (!items || items.length === 0) return [];
  const results: SymbolEntry[] = [];

  for (const item of items) {
    const qualifiedName = parentPath ? `${parentPath}.${item.text}` : item.text;

    const span = item.spans?.[0];
    if (span) {
      const position = resolvePosition(span.start);
      results.push({
        name: item.text,
        qualifiedName,
        kind: item.kind,
        line: position.lineNumber,
        column: position.column,
      });
    }

    if (item.childItems && item.childItems.length > 0) {
      results.push(
        ...flattenNavigationItems(item.childItems, resolvePosition, qualifiedName)
      );
    }
  }

  return results;
}

/**
 * Flatten Monaco's proper declaration tree into navigable rows. The worker's
 * top node always represents the source file itself, so start at its children
 * instead of leaking a synthetic `<global>` or quoted file name into results.
 */
export function flattenNavigationTree(
  tree: NavigationTreeItem | undefined,
  resolvePosition: PositionResolver
): SymbolEntry[] {
  return flattenNavigationItems(tree?.childItems, resolvePosition);
}

/**
 * Case-insensitive substring match on both the short and qualified name.
 * Empty queries return the full list so the overlay can render the symbol
 * outline without requiring a query.
 */
export function filterSymbols(entries: readonly SymbolEntry[], query: string): SymbolEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...entries];

  return entries.filter((entry) => {
    const name = entry.name.toLowerCase();
    const qualified = entry.qualifiedName.toLowerCase();
    return name.includes(normalized) || qualified.includes(normalized);
  });
}
