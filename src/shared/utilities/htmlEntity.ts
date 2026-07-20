/**
 * implementation note — `html-entity-encode` + `html-entity-decode`
 * adapters.
 *
 * Encode escapes the five HTML/XML special characters to named
 * entities (the safe-output set); decode reverses a common named set
 * plus numeric references (`&#NN;` decimal, `&#xHH;` hex). Pure shared
 * implementation. Encode intentionally does NOT entity-encode every
 * non-ASCII rune — it is the HTML-escaping use case, not a transport
 * encoder.
 */

import type { UtilityAdapter } from './types';

/** No options. */
export type HtmlEntityOptions = Record<string, never>;

function parseEmptyOptions(raw: unknown): HtmlEntityOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

/** The five characters that must be escaped for safe HTML output. */
const ENCODE_MAP: ReadonlyArray<readonly [string, string]> = [
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
];

/** Common named entities the decoder understands (beyond numeric refs). */
const NAMED_DECODE: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

function encodeHtmlEntities(input: string): string {
  let out = input;
  for (const [char, entity] of ENCODE_MAP) {
    out = out.split(char).join(entity);
  }
  return out;
}

function decodeHtmlEntities(input: string): string {
  return input.replace(
    /&(#(?:[0-9]+|x[0-9a-fA-F]+|X[0-9a-fA-F]+)|[a-zA-Z][a-zA-Z0-9]*);/gu,
    (match, body: string) => {
      if (body[0] === '#') {
        const isHex = body[1] === 'x' || body[1] === 'X';
        const codePoint = parseInt(
          body.slice(isHex ? 2 : 1),
          isHex ? 16 : 10
        );
        if (
          !Number.isFinite(codePoint) ||
          codePoint < 0 ||
          codePoint > 0x10ffff
        ) {
          return match;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      const named = NAMED_DECODE[body];
      return named ?? match;
    }
  );
}

export const htmlEntityEncodeAdapter: UtilityAdapter<HtmlEntityOptions> = {
  id: 'html-entity-encode',
  titleKey: 'utilityPipeline.adapter.htmlEntityEncode.title',
  descriptionKey: 'utilityPipeline.adapter.htmlEntityEncode.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => ({ ok: true, value: encodeHtmlEntities(input) }),
};

export const htmlEntityDecodeAdapter: UtilityAdapter<HtmlEntityOptions> = {
  id: 'html-entity-decode',
  titleKey: 'utilityPipeline.adapter.htmlEntityDecode.title',
  descriptionKey: 'utilityPipeline.adapter.htmlEntityDecode.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => ({ ok: true, value: decodeHtmlEntities(input) }),
};
