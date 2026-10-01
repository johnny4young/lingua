/** Normalized LSP destinations are data, never filesystem permissions. */
interface LspNavigationRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}
export interface LspNavigationLocation {
  uri: string;
  range: LspNavigationRange;
}
export interface LspNavigationCapabilities {
  definition: boolean;
  references: boolean;
}

export function readLspNavigationCapabilities(result: unknown): LspNavigationCapabilities {
  const capabilities =
    result && typeof result === 'object' && 'capabilities' in result ? result.capabilities : null;
  const enabled = (key: string) =>
    Boolean(
      capabilities &&
      typeof capabilities === 'object' &&
      key in capabilities &&
      ((capabilities as Record<string, unknown>)[key] === true ||
        (typeof (capabilities as Record<string, unknown>)[key] === 'object' &&
          (capabilities as Record<string, unknown>)[key] !== null))
    );
  return { definition: enabled('definitionProvider'), references: enabled('referencesProvider') };
}
function range(value: unknown): value is LspNavigationRange {
  if (!value || typeof value !== 'object') return false;
  const r = value as LspNavigationRange;
  const point = (p: LspNavigationRange['start'] | undefined) =>
    p &&
    Number.isSafeInteger(p.line) &&
    p.line >= 0 &&
    Number.isSafeInteger(p.character) &&
    p.character >= 0;
  return Boolean(
    point(r.start) &&
    point(r.end) &&
    (r.end.line > r.start.line ||
      (r.end.line === r.start.line && r.end.character >= r.start.character))
  );
}
export function normalizeLspLocations(response: unknown): readonly LspNavigationLocation[] {
  const values = Array.isArray(response) ? response : response ? [response] : [];
  // Bound untrusted server fanout; malformed entries never become navigation.
  if (values.length > 1000) return [];
  return values.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const uri = value.targetUri ?? value.uri;
    const selection = value.targetSelectionRange ?? value.range;
    if (typeof uri !== 'string' || uri.length > 8192 || !range(selection)) return [];
    return [{ uri, range: selection }];
  });
}
