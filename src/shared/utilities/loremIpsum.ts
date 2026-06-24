/**
 * Lorem Ipsum generator.
 *
 * Originally RL-068 (renderer-side); moved into the shared utility layer
 * under RL-099 Slice 7 (fold A) so the pipeline `lorem-ipsum` adapter and
 * the renderer's Lorem Ipsum panel share one corpus + assembler — the
 * renderer's `src/renderer/utils/loremIpsum.ts` is now a re-export shim,
 * so the Latin word list can no longer drift between two copies.
 *
 * Pure, offline. Assembles placeholder text from the classical Latin word
 * corpus. Three output modes (words / sentences / paragraphs), an optional
 * "start with the canonical opening phrase" flag, and mid-sentence commas
 * so the output reads like natural text rather than keyword soup.
 *
 * Uses `Math.random()` — no cryptographic guarantees and no seeded
 * determinism. Tests assert structural properties (word counts,
 * capitalization, sentence terminators, paragraph separators) rather
 * than exact byte output.
 */

import type { AdapterRunOutcome, UtilityAdapter, UtilityOptionField } from './types';

export type LoremIpsumUnit = 'words' | 'sentences' | 'paragraphs';

export interface LoremIpsumOptions {
  unit: LoremIpsumUnit;
  /** Clamped to the per-unit ceiling below. */
  count: number;
  /** Force the output to open with the canonical "Lorem ipsum dolor sit amet, consectetur adipiscing elit." phrase. */
  startWithClassic: boolean;
}

export const LOREM_IPSUM_MAX_WORDS = 500;
export const LOREM_IPSUM_MAX_SENTENCES = 50;
export const LOREM_IPSUM_MAX_PARAGRAPHS = 20;

const CLASSIC_OPENING_WORDS =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

/**
 * Classical Latin corpus trimmed to the words that appear in the
 * widely-used Lorem Ipsum reference block. Capitalized instances are
 * synthesized at sentence-start time, so the corpus stays lowercase.
 */
const CORPUS = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'sed',
  'do',
  'eiusmod',
  'tempor',
  'incididunt',
  'ut',
  'labore',
  'et',
  'dolore',
  'magna',
  'aliqua',
  'enim',
  'ad',
  'minim',
  'veniam',
  'quis',
  'nostrud',
  'exercitation',
  'ullamco',
  'laboris',
  'nisi',
  'aliquip',
  'ex',
  'ea',
  'commodo',
  'consequat',
  'duis',
  'aute',
  'irure',
  'in',
  'reprehenderit',
  'voluptate',
  'velit',
  'esse',
  'cillum',
  'eu',
  'fugiat',
  'nulla',
  'pariatur',
  'excepteur',
  'sint',
  'occaecat',
  'cupidatat',
  'non',
  'proident',
  'sunt',
  'culpa',
  'qui',
  'officia',
  'deserunt',
  'mollit',
  'anim',
  'id',
  'est',
  'laborum',
  'curabitur',
  'pretium',
  'tincidunt',
  'lacus',
  'gravida',
  'orci',
  'vivamus',
  'placerat',
  'suscipit',
  'purus',
  'donec',
  'aliquet',
  'faucibus',
  'augue',
  'vitae',
  'mauris',
];

function randomInt(minInclusive: number, maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

function randomWord(): string {
  return CORPUS[Math.floor(Math.random() * CORPUS.length)] ?? 'lorem';
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Build a sentence of 5-12 words. The first word is capitalized; the
 * last word gets a period. A comma is sprinkled once inside sentences
 * of length >= 6 so the output reads with natural cadence instead of
 * keyword soup. The optional leading fragment lets the "start with
 * classic" mode inject "Lorem ipsum dolor sit amet, consectetur
 * adipiscing elit" as the first sentence.
 */
function buildSentence(leading?: string): string {
  if (leading !== undefined) {
    return `${leading}.`;
  }
  const length = randomInt(5, 12);
  const words: string[] = [];
  for (let i = 0; i < length; i += 1) {
    words.push(randomWord());
  }
  // Capitalize the first word.
  words[0] = capitalize(words[0] ?? 'lorem');
  // Inject a mid-sentence comma once when there's room for it.
  if (length >= 6) {
    const commaAt = randomInt(2, length - 3);
    words[commaAt] = `${words[commaAt] ?? ''},`;
  }
  return `${words.join(' ')}.`;
}

function buildParagraph(leadingSentence?: string): string {
  const length = randomInt(3, 6);
  const sentences: string[] = [];
  for (let i = 0; i < length; i += 1) {
    if (i === 0 && leadingSentence !== undefined) {
      sentences.push(buildSentence(leadingSentence));
      continue;
    }
    sentences.push(buildSentence());
  }
  return sentences.join(' ');
}

function clampCount(unit: LoremIpsumUnit, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const max =
    unit === 'words'
      ? LOREM_IPSUM_MAX_WORDS
      : unit === 'sentences'
        ? LOREM_IPSUM_MAX_SENTENCES
        : LOREM_IPSUM_MAX_PARAGRAPHS;
  return Math.min(Math.floor(count), max);
}

/**
 * Generate placeholder text per `options`. Returns the assembled string
 * (never `null`) — an empty count yields an empty string.
 */
export function generateLorem(options: LoremIpsumOptions): string {
  const count = clampCount(options.unit, options.count);
  if (count === 0) return '';

  if (options.unit === 'words') {
    const words: string[] = [];
    if (options.startWithClassic) {
      // Split the canonical opening into its individual words so the
      // count knob still controls the total — "consectetur" counts as
      // one word, the comma does not.
      const classicWords = CLASSIC_OPENING_WORDS.replace(/,/g, '').split(' ');
      for (const word of classicWords) {
        if (words.length >= count) break;
        words.push(word);
      }
    }
    while (words.length < count) {
      words.push(words.length === 0 ? capitalize(randomWord()) : randomWord());
    }
    return words.join(' ');
  }

  if (options.unit === 'sentences') {
    const sentences: string[] = [];
    for (let i = 0; i < count; i += 1) {
      if (i === 0 && options.startWithClassic) {
        sentences.push(buildSentence(CLASSIC_OPENING_WORDS));
        continue;
      }
      sentences.push(buildSentence());
    }
    return sentences.join(' ');
  }

  // Paragraphs.
  const paragraphs: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i === 0 && options.startWithClassic) {
      paragraphs.push(buildParagraph(CLASSIC_OPENING_WORDS));
      continue;
    }
    paragraphs.push(buildParagraph());
  }
  return paragraphs.join('\n\n');
}

// ---------------------------------------------------------------------------
// RL-099 Slice 7 — `lorem-ipsum` pipeline adapter (generator).
// ---------------------------------------------------------------------------

const LOREM_UNITS: readonly LoremIpsumUnit[] = ['words', 'sentences', 'paragraphs'];
const LOREM_UNIT_SET: ReadonlySet<string> = new Set(LOREM_UNITS);

/** Default count for a fresh `lorem-ipsum` step. */
export const LOREM_ADAPTER_DEFAULT_COUNT = 3;

/**
 * Structured options for the `lorem-ipsum` adapter. `count` is a string
 * because the options form renders it as a `text` field; `generateLorem`
 * clamps the numeric value to the per-unit ceiling.
 */
export interface LoremIpsumAdapterOptions {
  readonly unit: LoremIpsumUnit;
  readonly count: string;
  readonly startWithClassic: boolean;
}

const UNIT_OPTION: UtilityOptionField = {
  key: 'unit',
  type: 'select',
  labelKey: 'utilityPipeline.adapter.loremIpsum.options.unit.label',
  defaultValue: 'paragraphs',
  options: LOREM_UNITS.map((value) => ({
    value,
    labelKey: `utilityPipeline.adapter.loremIpsum.options.unit.${value}`,
  })),
};

const COUNT_OPTION: UtilityOptionField = {
  key: 'count',
  type: 'text',
  labelKey: 'utilityPipeline.adapter.loremIpsum.options.count.label',
  defaultValue: String(LOREM_ADAPTER_DEFAULT_COUNT),
};

const CLASSIC_OPTION: UtilityOptionField = {
  key: 'startWithClassic',
  type: 'boolean',
  labelKey: 'utilityPipeline.adapter.loremIpsum.options.startWithClassic.label',
  defaultValue: true,
};

export const loremIpsumAdapter: UtilityAdapter<LoremIpsumAdapterOptions> = {
  id: 'lorem-ipsum',
  titleKey: 'utilityPipeline.adapter.loremIpsum.title',
  descriptionKey: 'utilityPipeline.adapter.loremIpsum.description',
  // A generator: ignores the chained input and emits placeholder text.
  // Declares `text` kinds so it composes anywhere; the upstream value is
  // discarded by design (generators are source steps).
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [UNIT_OPTION, COUNT_OPTION, CLASSIC_OPTION],
  defaultOptions: () => ({
    unit: 'paragraphs',
    count: String(LOREM_ADAPTER_DEFAULT_COUNT),
    startWithClassic: true,
  }),
  parseOptions: (raw): LoremIpsumAdapterOptions | null => {
    if (raw === undefined || raw === null) {
      return {
        unit: 'paragraphs',
        count: String(LOREM_ADAPTER_DEFAULT_COUNT),
        startWithClassic: true,
      };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as {
      unit?: unknown;
      count?: unknown;
      startWithClassic?: unknown;
    };
    const unit = candidate.unit === undefined ? 'paragraphs' : candidate.unit;
    if (typeof unit !== 'string' || !LOREM_UNIT_SET.has(unit)) return null;
    const count =
      candidate.count === undefined ? String(LOREM_ADAPTER_DEFAULT_COUNT) : candidate.count;
    if (typeof count !== 'string') return null;
    const startWithClassic =
      candidate.startWithClassic === undefined ? true : candidate.startWithClassic;
    if (typeof startWithClassic !== 'boolean') return null;
    return { unit: unit as LoremIpsumUnit, count, startWithClassic };
  },
  run: async (_input, options): Promise<AdapterRunOutcome<string>> => {
    const value = generateLorem({
      unit: options.unit,
      count: Number(options.count),
      startWithClassic: options.startWithClassic,
    });
    return { ok: true, value };
  },
};
