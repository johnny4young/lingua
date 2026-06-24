/**
 * String Inspector.
 *
 * Originally RL-072 (renderer-side); moved into the shared utility layer
 * under RL-099 Slice 7 (fold A) so the pipeline `string-inspect` adapter
 * and the renderer's String Inspector panel share one implementation —
 * the renderer's `src/renderer/utils/stringInspector.ts` is now a
 * re-export shim, so the detection tables (zero-width / BiDi ranges,
 * homoglyph set) can no longer drift between two copies.
 *
 * Pure, offline. Turns an arbitrary string into a structural report that
 * surfaces the things a developer usually has to open `hexdump` to see:
 * per-codepoint rows, byte counts under both UTF-8 and UTF-16, approximate
 * grapheme clusters, and explicit warnings for the four most common "why
 * is my string breaking" culprits:
 *
 *   - zero-width joiners / BOMs / word joiners that render to nothing
 *   - BiDi override / isolate controls that reverse visual ordering
 *   - mixed-script runs (e.g. Latin + Cyrillic in one word)
 *   - homoglyph pairs (Latin / Cyrillic look-alikes used in phishing)
 *
 * The helper never throws and always returns a finite report — inputs
 * longer than `INSPECT_MAX_CHARS` are truncated for row rendering but
 * counts reflect the full original input.
 */

import type { AdapterRunOutcome, UtilityAdapter } from './types';

export interface CharacterRow {
  index: number;
  codePoint: number;
  hex: string;
  glyph: string;
  category: CharacterCategory;
  name?: string;
}

export type CharacterCategory =
  | 'printable'
  | 'whitespace'
  | 'control'
  | 'invisible'
  | 'bidi';

export type WarningKind = 'zero-width' | 'bidi-control' | 'mixed-script' | 'homoglyph';

export interface InspectionWarning {
  kind: WarningKind;
  at: number[];
}

export interface InspectionReport {
  characters: CharacterRow[];
  counts: {
    charactersUtf16: number;
    graphemesApprox: number;
    bytesUtf8: number;
    bytesUtf16: number;
  };
  warnings: InspectionWarning[];
  truncated: boolean;
  totalCharacters: number;
}

/** Row cap before the panel starts virtualizing. Inputs beyond this still
 *  contribute to the counts; only the per-row table is trimmed. */
export const INSPECT_MAX_CHARS = 2000;

// ---------------------------------------------------------------------------
// Detection tables
// ---------------------------------------------------------------------------

const ZERO_WIDTH_RANGES: readonly (readonly [number, number])[] = [
  [0x200b, 0x200f], // ZWSP, ZWNJ, ZWJ, LRM, RLM
  [0x2028, 0x202f], // line/paragraph separators + narrow NBSP
  [0x2060, 0x206f], // word joiner, invisible operators
  [0xfeff, 0xfeff], // BOM / ZWNBSP
];

const BIDI_RANGES: readonly (readonly [number, number])[] = [
  [0x202a, 0x202e], // LRE / RLE / PDF / LRO / RLO
  [0x2066, 0x2069], // LRI / RLI / FSI / PDI
];

/**
 * Latin / Cyrillic homoglyph pairs that the Unicode Consortium flags as
 * confusables in its TR-39 security profile. We ship the common web-
 * phishing subset — not exhaustive, but covers the pasted-URL case.
 */
const HOMOGLYPHS = new Set([
  'а', // U+0430 CYRILLIC SMALL LETTER A — looks like Latin 'a'
  'е', // U+0435 CYRILLIC SMALL LETTER IE — looks like Latin 'e'
  'о', // U+043E CYRILLIC SMALL LETTER O — looks like Latin 'o'
  'р', // U+0440 CYRILLIC SMALL LETTER ER — looks like Latin 'p'
  'с', // U+0441 CYRILLIC SMALL LETTER ES — looks like Latin 'c'
  'у', // U+0443 CYRILLIC SMALL LETTER U — looks like Latin 'y'
  'х', // U+0445 CYRILLIC SMALL LETTER HA — looks like Latin 'x'
  'і', // U+0456 CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I — looks like Latin 'i'
  'ј', // U+0458 CYRILLIC SMALL LETTER JE — looks like Latin 'j'
]);

function inRange(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

function categorize(cp: number, ch: string): CharacterCategory {
  if (inRange(cp, BIDI_RANGES)) return 'bidi';
  if (inRange(cp, ZERO_WIDTH_RANGES)) return 'invisible';
  if (cp < 0x20 || cp === 0x7f) {
    // ASCII C0 controls — treat tab / LF / CR as whitespace so users do
    // not see every newline tagged as a control character.
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return 'whitespace';
    return 'control';
  }
  if (/^\s$/u.test(ch)) return 'whitespace';
  return 'printable';
}

function codePointToHex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Heuristic script detection for the mixed-script + homoglyph warnings. */
type Script = 'latin' | 'cyrillic' | 'greek' | 'other';

function scriptOf(cp: number): Script {
  if ((cp >= 0x0041 && cp <= 0x005a) || (cp >= 0x0061 && cp <= 0x007a)) return 'latin';
  if (cp >= 0x00c0 && cp <= 0x024f) return 'latin'; // Latin-1 Supplement + Extended A/B
  if (cp >= 0x0400 && cp <= 0x04ff) return 'cyrillic';
  if (cp >= 0x0370 && cp <= 0x03ff) return 'greek';
  return 'other';
}

function isLetterCodePoint(cp: number): boolean {
  return scriptOf(cp) !== 'other' || (cp >= 0x0030 && cp <= 0x0039);
}

function tokenizeWords(input: string): { start: number; text: string }[] {
  const tokens: { start: number; text: string }[] = [];
  let current = '';
  let tokenStart = 0;
  let index = 0;

  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    const isAlpha = isLetterCodePoint(cp);
    if (isAlpha) {
      if (current.length === 0) tokenStart = index;
      current += ch;
    } else if (current.length > 0) {
      tokens.push({ start: tokenStart, text: current });
      current = '';
    }
    index += ch.length;
  }
  if (current.length > 0) tokens.push({ start: tokenStart, text: current });
  return tokens;
}

function detectMixedScript(input: string): number[] {
  const offsets: number[] = [];
  for (const token of tokenizeWords(input)) {
    const scripts = new Set<Script>();
    for (const ch of token.text) {
      const cp = ch.codePointAt(0) ?? 0;
      const s = scriptOf(cp);
      if (s !== 'other') scripts.add(s);
    }
    // Count only tokens that mix >=2 distinct scripts among {latin, cyrillic, greek}.
    if (scripts.size >= 2) offsets.push(token.start);
  }
  return offsets;
}

function detectHomoglyphs(input: string): number[] {
  const offsets: number[] = [];
  for (const token of tokenizeWords(input)) {
    let tokenIndex = token.start;
    let hasLatin = false;
    const suspicious: number[] = [];

    for (const ch of token.text) {
      const cp = ch.codePointAt(0) ?? 0;
      if (scriptOf(cp) === 'latin') hasLatin = true;
      if (HOMOGLYPHS.has(ch)) suspicious.push(tokenIndex);
      tokenIndex += ch.length;
    }

    if (hasLatin) {
      offsets.push(...suspicious);
    }
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function inspect(input: string): InspectionReport {
  const bytesUtf8 = new TextEncoder().encode(input).length;
  const bytesUtf16 = input.length * 2;
  const graphemeArray = Array.from(input);
  const truncated = graphemeArray.length > INSPECT_MAX_CHARS;
  const rowPool = truncated ? graphemeArray.slice(0, INSPECT_MAX_CHARS) : graphemeArray;

  const characters: CharacterRow[] = [];
  const zeroWidthHits: number[] = [];
  const bidiHits: number[] = [];

  let bufferOffset = 0;
  for (const ch of rowPool) {
    const cp = ch.codePointAt(0) ?? 0;
    const category = categorize(cp, ch);
    if (category === 'invisible') zeroWidthHits.push(bufferOffset);
    if (category === 'bidi') bidiHits.push(bufferOffset);
    characters.push({
      index: bufferOffset,
      codePoint: cp,
      hex: codePointToHex(cp),
      glyph: category === 'printable' || category === 'whitespace' ? ch : '·',
      category,
    });
    bufferOffset += ch.length;
  }

  const warnings: InspectionWarning[] = [];
  if (zeroWidthHits.length > 0) warnings.push({ kind: 'zero-width', at: zeroWidthHits });
  if (bidiHits.length > 0) warnings.push({ kind: 'bidi-control', at: bidiHits });

  const mixedScriptAt = detectMixedScript(input);
  if (mixedScriptAt.length > 0) warnings.push({ kind: 'mixed-script', at: mixedScriptAt });

  const homoglyphAt = detectHomoglyphs(input);
  if (homoglyphAt.length > 0) warnings.push({ kind: 'homoglyph', at: homoglyphAt });

  return {
    characters,
    counts: {
      charactersUtf16: input.length,
      graphemesApprox: graphemeArray.length,
      bytesUtf8,
      bytesUtf16,
    },
    warnings,
    truncated,
    totalCharacters: graphemeArray.length,
  };
}

// ---------------------------------------------------------------------------
// RL-099 Slice 7 — `string-inspect` pipeline adapter (transform).
// ---------------------------------------------------------------------------

let segmenter: Intl.Segmenter | null = null;

/** True grapheme-cluster count via `Intl.Segmenter` (distinct from code
 *  points for emoji ZWJ sequences and combining marks). Lazily built. */
function countGraphemes(input: string): number {
  if (input === '') return 0;
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let count = 0;
  for (const _segment of segmenter.segment(input)) count += 1;
  return count;
}

/**
 * Count zero-width and BiDi-control code points across the FULL input
 * (unlike the renderer table's `INSPECT_MAX_CHARS` row cap, the pipeline
 * step must report accurate totals on large pastes). BiDi is checked
 * first because its range nests inside the zero-width range — mirroring
 * `categorize()`'s precedence.
 */
function countHiddenControls(input: string): { zeroWidth: number; bidi: number } {
  let zeroWidth = 0;
  let bidi = 0;
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (inRange(cp, BIDI_RANGES)) bidi += 1;
    else if (inRange(cp, ZERO_WIDTH_RANGES)) zeroWidth += 1;
  }
  return { zeroWidth, bidi };
}

/** `string-inspect` takes no options. */
export type StringInspectOptions = Record<string, never>;

function parseEmptyOptions(raw: unknown): StringInspectOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

export const stringInspectAdapter: UtilityAdapter<StringInspectOptions> = {
  id: 'string-inspect',
  titleKey: 'utilityPipeline.adapter.stringInspect.title',
  descriptionKey: 'utilityPipeline.adapter.stringInspect.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input): Promise<AdapterRunOutcome<string>> => {
    // Fixed-label computed data (like `text-stats` / `timestamp` output),
    // rendered verbatim in the result <pre> and kept `text` so a later
    // step can still consume it. Graphemes = true clusters; code points =
    // Unicode scalars; UTF-16 units = JS string length; UTF-8 bytes =
    // encoded length. The Warnings line (fold E) is the inspector's
    // headline security signal that text-stats does not surface.
    const graphemes = countGraphemes(input);
    const codePoints = [...input].length;
    const utf16 = input.length;
    const utf8 = new TextEncoder().encode(input).length;
    const { zeroWidth, bidi } = countHiddenControls(input);
    const value = [
      `Graphemes: ${graphemes}`,
      `Code points: ${codePoints}`,
      `UTF-16 units: ${utf16}`,
      `UTF-8 bytes: ${utf8}`,
      `Warnings: zero-width ${zeroWidth}, bidi-control ${bidi}`,
    ].join('\n');
    return { ok: true, value };
  },
};
