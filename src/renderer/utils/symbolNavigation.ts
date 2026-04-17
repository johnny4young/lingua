/**
 * Helpers for extracting a flat, navigable symbol list from Monaco's
 * TypeScript worker output. Kept pure and side-effect-free so the flattening
 * rules can be unit-tested without spinning up Monaco.
 */

export interface NavigationBarSpan {
  start: number;
  length: number;
}

export interface NavigationBarItem {
  text: string;
  kind: string;
  spans: NavigationBarSpan[];
  childItems?: NavigationBarItem[];
  /**
   * TS sometimes emits a `bolded: true` flag on important children — we
   * ignore it because the fuzzy filter handles ranking.
   */
  bolded?: boolean;
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
 * TS's navigation bar wraps every file in a synthetic `<global>` container
 * (or `"<function>"` for anonymous IIFEs). Those parents carry no useful
 * name so we skip them and flatten their children at the top level.
 */
const SYNTHETIC_PARENT_LABELS = new Set(['<global>', '<function>', '']);

/**
 * Monaco's language IDs that expose symbols through `getNavigationBarItems`.
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
 * Walk TS's navigation bar tree, skipping synthetic roots and converting
 * character offsets to Monaco line/column pairs. Deterministic in the order
 * TS emits items so the overlay preserves source order.
 */
export function flattenNavigationItems(
  items: readonly NavigationBarItem[] | undefined,
  resolvePosition: PositionResolver,
  parentPath = ''
): SymbolEntry[] {
  if (!items || items.length === 0) return [];
  const results: SymbolEntry[] = [];

  for (const item of items) {
    const isSynthetic = SYNTHETIC_PARENT_LABELS.has(item.text);
    // Synthetic wrappers contribute no row of their own but we still recurse
    // into their children so top-level declarations surface.
    if (isSynthetic) {
      results.push(
        ...flattenNavigationItems(item.childItems, resolvePosition, parentPath)
      );
      continue;
    }

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
