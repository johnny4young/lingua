/**
 * RL-068 — HTML Entity Encode/Decode helper.
 *
 * Pure, offline, renderer-side. Ships three encoding strategies + a single
 * decoder that handles named, decimal numeric, and hex numeric references.
 *
 * Strategy choice:
 * - `minimal`: only the five characters the HTML spec actually requires to
 *   be escaped in element content / attributes (`&`, `<`, `>`, `"`, `'`).
 * - `named`: minimal plus a curated set of widely-supported named entities
 *   (Latin-1 supplement + a few punctuation / symbol regulars). Codepoints
 *   outside the named table fall back to decimal numeric so the output is
 *   always a valid reference.
 * - `numeric`: minimal plus every non-ASCII codepoint encoded as `&#NNN;`.
 *
 * The decoder never throws on unknown references — they pass through
 * unchanged (matching DevUtils behavior) and the caller gets an
 * "unresolvedCount" so the panel can surface a small hint without looking
 * like an error.
 *
 * No DOM, no `document`, no `innerHTML` tricks — this is pure string
 * arithmetic so the same module runs in the Electron renderer, the web
 * build, and vitest's jsdom setup identically.
 */

export type EncodeStrategy = 'minimal' | 'named' | 'numeric';

export interface DecodeResult {
  text: string;
  /**
   * How many `&…;` references in the input could not be resolved against
   * our decoder. They survived in the output verbatim.
   */
  unresolvedCount: number;
}

/**
 * Named-entity table, curated to the references a typical DevUtils user
 * pastes: HTML structural chars, Latin-1 Supplement, a few punctuation /
 * symbol regulars. Keeping the table small bounds the bundle cost; unknown
 * codepoints fall back to decimal numeric automatically.
 */
const NAMED_BY_CHAR: Readonly<Record<string, string>> = Object.freeze({
  '&': 'amp',
  '<': 'lt',
  '>': 'gt',
  '"': 'quot',
  "'": 'apos',
  '\u00a0': 'nbsp',
  '¡': 'iexcl',
  '¢': 'cent',
  '£': 'pound',
  '¤': 'curren',
  '¥': 'yen',
  '¦': 'brvbar',
  '§': 'sect',
  '¨': 'uml',
  '©': 'copy',
  'ª': 'ordf',
  '«': 'laquo',
  '¬': 'not',
  '®': 'reg',
  '¯': 'macr',
  '°': 'deg',
  '±': 'plusmn',
  '²': 'sup2',
  '³': 'sup3',
  '´': 'acute',
  'µ': 'micro',
  '¶': 'para',
  '·': 'middot',
  '¸': 'cedil',
  '¹': 'sup1',
  'º': 'ordm',
  '»': 'raquo',
  '¼': 'frac14',
  '½': 'frac12',
  '¾': 'frac34',
  '¿': 'iquest',
  'À': 'Agrave',
  'Á': 'Aacute',
  'Â': 'Acirc',
  'Ã': 'Atilde',
  'Ä': 'Auml',
  'Å': 'Aring',
  'Æ': 'AElig',
  'Ç': 'Ccedil',
  'È': 'Egrave',
  'É': 'Eacute',
  'Ê': 'Ecirc',
  'Ë': 'Euml',
  'Ì': 'Igrave',
  'Í': 'Iacute',
  'Î': 'Icirc',
  'Ï': 'Iuml',
  'Ð': 'ETH',
  'Ñ': 'Ntilde',
  'Ò': 'Ograve',
  'Ó': 'Oacute',
  'Ô': 'Ocirc',
  'Õ': 'Otilde',
  'Ö': 'Ouml',
  '×': 'times',
  'Ø': 'Oslash',
  'Ù': 'Ugrave',
  'Ú': 'Uacute',
  'Û': 'Ucirc',
  'Ü': 'Uuml',
  'Ý': 'Yacute',
  'Þ': 'THORN',
  'ß': 'szlig',
  'à': 'agrave',
  'á': 'aacute',
  'â': 'acirc',
  'ã': 'atilde',
  'ä': 'auml',
  'å': 'aring',
  'æ': 'aelig',
  'ç': 'ccedil',
  'è': 'egrave',
  'é': 'eacute',
  'ê': 'ecirc',
  'ë': 'euml',
  'ì': 'igrave',
  'í': 'iacute',
  'î': 'icirc',
  'ï': 'iuml',
  'ð': 'eth',
  'ñ': 'ntilde',
  'ò': 'ograve',
  'ó': 'oacute',
  'ô': 'ocirc',
  'õ': 'otilde',
  'ö': 'ouml',
  '÷': 'divide',
  'ø': 'oslash',
  'ù': 'ugrave',
  'ú': 'uacute',
  'û': 'ucirc',
  'ü': 'uuml',
  'ý': 'yacute',
  'þ': 'thorn',
  'ÿ': 'yuml',
  '\u2014': 'mdash',
  '\u2013': 'ndash',
  '\u2018': 'lsquo',
  '\u2019': 'rsquo',
  '\u201c': 'ldquo',
  '\u201d': 'rdquo',
  '\u2020': 'dagger',
  '\u2021': 'Dagger',
  '\u2026': 'hellip',
  '\u20ac': 'euro',
  '™': 'trade',
  '←': 'larr',
  '↑': 'uarr',
  '→': 'rarr',
  '↓': 'darr',
});

const NAMED_BY_ENTITY: ReadonlyMap<string, string> = new Map(
  Object.entries(NAMED_BY_CHAR).map(([char, name]) => [name, char])
);

// Minimal-escape list — the five chars HTML always wants escaped in markup.
const MINIMAL_MAP: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

const ENTITY_REF_RE = /&(#(?:[xX][0-9A-Fa-f]+|[0-9]+)|[A-Za-z][A-Za-z0-9]{1,31});/g;

/** Is this character outside ASCII printable (so `named` / `numeric` should escape it)? */
function isNonAscii(ch: string): boolean {
  const code = ch.codePointAt(0);
  return code !== undefined && code > 0x7f;
}

function encodeMinimal(input: string): string {
  let out = '';
  for (const ch of input) {
    out += MINIMAL_MAP[ch as keyof typeof MINIMAL_MAP] ?? ch;
  }
  return out;
}

/**
 * Encode `input` using the chosen strategy. Always deterministic — identical
 * input + strategy always produces identical output.
 */
export function encodeHtmlEntities(input: string, strategy: EncodeStrategy): string {
  if (strategy === 'minimal') return encodeMinimal(input);

  let out = '';
  // Iterate by code point so surrogate pairs (emoji, astral) stay intact
  // and get encoded as a single numeric reference.
  for (const ch of input) {
    const minimal = MINIMAL_MAP[ch as keyof typeof MINIMAL_MAP];
    if (minimal !== undefined) {
      out += minimal;
      continue;
    }
    if (!isNonAscii(ch)) {
      out += ch;
      continue;
    }
    if (strategy === 'named') {
      const named = NAMED_BY_CHAR[ch];
      if (named) {
        out += `&${named};`;
        continue;
      }
    }
    // `numeric` — or `named` fallback when no entity is in the table.
    const code = ch.codePointAt(0) ?? ch.charCodeAt(0);
    out += `&#${code};`;
  }
  return out;
}

/**
 * Decode every recognised reference in `input`. Unknown references pass
 * through and contribute to `unresolvedCount`. Runaway patterns (unterminated
 * `&foo…`) are never matched so they naturally stay as plain text.
 */
export function decodeHtmlEntities(input: string): DecodeResult {
  let unresolvedCount = 0;
  const text = input.replace(ENTITY_REF_RE, (match, rawRef: string) => {
    const resolved = resolveEntity(rawRef);
    if (resolved === null) {
      unresolvedCount += 1;
      return match;
    }
    return resolved;
  });
  return { text, unresolvedCount };
}

function resolveEntity(reference: string): string | null {
  if (reference.startsWith('#')) {
    const body = reference.slice(1);
    const codePoint =
      body.startsWith('x') || body.startsWith('X')
        ? Number.parseInt(body.slice(1), 16)
        : Number.parseInt(body, 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return null;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return null;
    }
  }
  return NAMED_BY_ENTITY.get(reference) ?? null;
}
