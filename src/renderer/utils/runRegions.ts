import { walkTopLevelLines } from './magicComments/jsLexer';

export type RunRegionLanguage = 'javascript' | 'typescript' | 'python';

export interface RunRegion {
  /** 0-based position among the file's regions. */
  index: number;
  /** Text after `%%` up to the first `·`; null for unnamed markers and code above the first marker. */
  name: string | null;
  /** 1-based marker line, or null for code above the first marker. */
  markerLine: number | null;
  /** First and last 1-based line the region spans, its marker included. */
  startLine: number;
  endLine: number;
}

const COMMENT_VALUE_CHARS = 60;
const PY_MARKER = /^#\s?%%(.*)$/;
const PY_TRIPLE = /"""|'''/g;

export function supportsRunRegions(language: string): language is RunRegionLanguage {
  return language === 'javascript' || language === 'typescript' || language === 'python';
}

function nameOf(rest: string): string | null {
  const name = rest.split('·')[0]!.trim();
  return name.length > 0 ? name.slice(0, 40) : null;
}

/** Top-level `// %%` lines outside strings, templates and blocks. */
function jsMarkers(source: string): Array<[line: number, name: string | null]> {
  const markers: Array<[number, string | null]> = [];
  walkTopLevelLines(source, info => {
    if (info.openTokenAtStart || info.depthAtStart !== 0 || info.lineComment === null) return;
    const comment = info.lineComment.trimStart();
    if (!comment.startsWith('%%') || info.stripped.trim() !== '') return;
    markers.push([info.lineNumber, nameOf(comment.slice(2))]);
  });
  return markers;
}

/** `# %%` lines at column 0, skipping triple-quoted strings. */
function pythonMarkers(source: string): Array<[line: number, name: string | null]> {
  const markers: Array<[number, string | null]> = [];
  let open: string | null = null;
  source.split('\n').forEach((text, at) => {
    if (!open) {
      const match = PY_MARKER.exec(text.replace(/\r$/, ''));
      if (match) {
        markers.push([at + 1, nameOf(match[1] ?? '')]);
        return;
      }
    }
    for (const quote of (open ? text : text.replace(/#.*$/, '')).match(PY_TRIPLE) ?? []) {
      if (!open) open = quote;
      else if (open === quote) open = null;
    }
  });
  return markers;
}

/**
 * Splits a file at its `%%` markers. A file without markers has no regions;
 * code above the first marker becomes an unnamed region of its own.
 */
export function parseRunRegions(source: string, language: RunRegionLanguage): RunRegion[] {
  const markers = language === 'python' ? pythonMarkers(source) : jsMarkers(source);
  if (markers.length === 0) return [];
  const lineCount = source.split('\n').length;
  const regions: RunRegion[] = [];
  const firstMarker = markers[0]![0];
  const above = source.split('\n').slice(0, firstMarker - 1);
  if (above.some(line => line.trim() !== '')) {
    regions.push({ index: 0, name: null, markerLine: null, startLine: 1, endLine: firstMarker - 1 });
  }
  markers.forEach(([line, name], at) => {
    const next = markers[at + 1]?.[0];
    regions.push({ index: regions.length, name, markerLine: line, startLine: line, endLine: next ? next - 1 : lineCount });
  });
  return regions;
}

export function runRegionAt(regions: readonly RunRegion[], line: number): RunRegion | null {
  return regions.find(region => line >= region.startLine && line <= region.endLine) ?? null;
}

/** The source a region runs: every line up to its end, so the regions above set up its state. */
export function runRegionSource(source: string, region: RunRegion): string {
  return source.split('\n').slice(0, region.endLine).join('\n');
}

/** A one-line arrow comment the next run reads back as an inline value. */
export function resultComment(language: RunRegionLanguage, lineText: string, value: string): string | null {
  if (lineText.trim() === '' || (language === 'python' ? lineText.includes('#') : lineText.includes('//'))) return null;
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const shown = flat.length > COMMENT_VALUE_CHARS ? `${flat.slice(0, COMMENT_VALUE_CHARS - 1)}…` : flat;
  return language === 'python' ? `  # => ${shown}` : ` // => ${shown}`;
}
