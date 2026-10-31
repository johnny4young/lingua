import { walkTopLevelLines } from './magicComments/jsLexer';
import { replaceUnsafeText } from './unsafeText';

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

/** The triple quote still open after a Python line, given the one open before it. */
function tripleQuoteAfter(open: string | null, text: string): string | null {
  let current = open;
  for (const quote of (current ? text : text.replace(/#.*$/, '')).match(PY_TRIPLE) ?? []) {
    if (!current) current = quote;
    else if (current === quote) current = null;
  }
  return current;
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
    open = tripleQuoteAfter(open, text);
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

const PY_STRING = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;

/** The line ends in code, outside any string, comment or open bracket, so a comment can follow it. */
function endsInCode(source: string, line: number, language: RunRegionLanguage): boolean {
  if (language !== 'python') {
    let fits = false;
    walkTopLevelLines(source, info => {
      if (info.lineNumber === line) fits = !info.openTokenAtEnd && info.lineComment === null && info.depthAtEnd === 0 && info.stripped.trim() !== '';
    });
    return fits;
  }
  const lines = source.split('\n');
  let open: string | null = null;
  for (let at = 0; at < line - 1; at += 1) open = tripleQuoteAfter(open, lines[at]!);
  const text = (lines[line - 1] ?? '').replace(/\r$/, '');
  if (open || text.trim() === '' || text.trimEnd().endsWith('\\')) return false;
  const code = text.replace(PY_STRING, '""');
  if (code.includes('#') || /['"]/.test(code.replace(/""/g, ''))) return false;
  const depth = [...code].reduce((sum, char) => sum + ('([{'.includes(char) ? 1 : ')]}'.includes(char) ? -1 : 0), 0);
  return depth === 0;
}

/** A one-line arrow comment the next run reads back as an inline value, or null where one cannot safely go. */
export function resultComment(language: RunRegionLanguage, source: string, line: number, value: string): string | null {
  if (!endsInCode(source, line, language)) return null;
  const flat = replaceUnsafeText(value).replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const chars = Array.from(flat);
  const shown = chars.length > COMMENT_VALUE_CHARS ? `${chars.slice(0, COMMENT_VALUE_CHARS - 1).join('')}…` : flat;
  return language === 'python' ? `  # => ${shown}` : ` // => ${shown}`;
}
