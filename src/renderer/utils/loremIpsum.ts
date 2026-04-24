/**
 * RL-068 — Lorem Ipsum Generator helper.
 *
 * Pure, offline, renderer-side. Assembles placeholder text from the
 * classical Latin word corpus. Three output modes (words / sentences /
 * paragraphs), an optional "start with the canonical opening phrase"
 * flag, and mid-sentence commas so the output reads like natural text
 * rather than keyword soup.
 *
 * Uses `Math.random()` — no cryptographic guarantees and no seeded
 * determinism. Tests assert structural properties (word counts,
 * capitalization, sentence terminators, paragraph separators) rather
 * than exact byte output.
 */

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
