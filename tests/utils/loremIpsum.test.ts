import { describe, expect, it, vi } from 'vitest';
import {
  LOREM_IPSUM_MAX_PARAGRAPHS,
  LOREM_IPSUM_MAX_SENTENCES,
  LOREM_IPSUM_MAX_WORDS,
  generateLorem,
} from '@/utils/loremIpsum';

const CLASSIC_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

describe('generateLorem — words', () => {
  it('returns an empty string when count is 0', () => {
    expect(generateLorem({ unit: 'words', count: 0, startWithClassic: false })).toBe('');
  });

  it('returns an empty string for negative count', () => {
    expect(generateLorem({ unit: 'words', count: -5, startWithClassic: false })).toBe('');
  });

  it('returns exactly `count` space-separated words', () => {
    const output = generateLorem({ unit: 'words', count: 12, startWithClassic: false });
    expect(output.split(' ')).toHaveLength(12);
  });

  it('capitalizes the first word in words mode', () => {
    const output = generateLorem({ unit: 'words', count: 5, startWithClassic: false });
    const first = output.split(' ')[0] ?? '';
    expect(first.charAt(0)).toBe(first.charAt(0).toUpperCase());
  });

  it('starts with the classic opening when startWithClassic is true', () => {
    const output = generateLorem({ unit: 'words', count: 15, startWithClassic: true });
    // Classic opening is 8 words (without the comma in words mode).
    expect(output.startsWith('Lorem ipsum dolor sit amet consectetur adipiscing elit')).toBe(true);
    expect(output.split(' ')).toHaveLength(15);
  });

  it('truncates the classic prefix when count is smaller than the opening phrase', () => {
    // Classic is 8 words. With count=3 and classic on, we expect the
    // first 3 words of the canonical phrase ("Lorem ipsum dolor").
    const output = generateLorem({ unit: 'words', count: 3, startWithClassic: true });
    expect(output).toBe('Lorem ipsum dolor');
  });

  it('clamps words count to LOREM_IPSUM_MAX_WORDS', () => {
    const output = generateLorem({
      unit: 'words',
      count: LOREM_IPSUM_MAX_WORDS + 100,
      startWithClassic: false,
    });
    expect(output.split(' ')).toHaveLength(LOREM_IPSUM_MAX_WORDS);
  });
});

describe('generateLorem — sentences', () => {
  it('returns an empty string for count 0', () => {
    expect(generateLorem({ unit: 'sentences', count: 0, startWithClassic: false })).toBe('');
  });

  it('produces exactly `count` sentences each ending with a period', () => {
    const output = generateLorem({ unit: 'sentences', count: 5, startWithClassic: false });
    // Split on ". " but keep the trailing period by matching on the regex
    // with lookbehind-free logic: count the periods.
    const periodCount = (output.match(/\./g) ?? []).length;
    expect(periodCount).toBe(5);
  });

  it('opens with the canonical sentence when startWithClassic is true', () => {
    const output = generateLorem({ unit: 'sentences', count: 3, startWithClassic: true });
    expect(output.startsWith(CLASSIC_OPENING)).toBe(true);
  });

  it('every sentence starts with a capital letter', () => {
    const output = generateLorem({ unit: 'sentences', count: 8, startWithClassic: false });
    const sentences = output.split('. ');
    for (const sentence of sentences) {
      if (sentence.length === 0) continue;
      expect(sentence.charAt(0)).toBe(sentence.charAt(0).toUpperCase());
    }
  });

  it('sprinkles commas inside longer sentences', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const output = generateLorem({ unit: 'sentences', count: 1, startWithClassic: false });
      expect(output).toContain(',');
    } finally {
      random.mockRestore();
    }
  });

  it('clamps sentences count to LOREM_IPSUM_MAX_SENTENCES', () => {
    const output = generateLorem({
      unit: 'sentences',
      count: LOREM_IPSUM_MAX_SENTENCES + 20,
      startWithClassic: false,
    });
    const periodCount = (output.match(/\./g) ?? []).length;
    expect(periodCount).toBe(LOREM_IPSUM_MAX_SENTENCES);
  });
});

describe('generateLorem — paragraphs', () => {
  it('returns an empty string for count 0', () => {
    expect(generateLorem({ unit: 'paragraphs', count: 0, startWithClassic: false })).toBe('');
  });

  it('separates paragraphs with double newlines', () => {
    const output = generateLorem({ unit: 'paragraphs', count: 3, startWithClassic: false });
    const paragraphs = output.split('\n\n');
    expect(paragraphs).toHaveLength(3);
    for (const paragraph of paragraphs) {
      // Each paragraph is non-empty and ends with a period.
      expect(paragraph.length).toBeGreaterThan(0);
      expect(paragraph.endsWith('.')).toBe(true);
    }
  });

  it('first paragraph opens with the canonical phrase when startWithClassic is true', () => {
    const output = generateLorem({ unit: 'paragraphs', count: 2, startWithClassic: true });
    expect(output.startsWith(CLASSIC_OPENING)).toBe(true);
  });

  it('each paragraph contains between 3 and 6 sentences (inclusive)', () => {
    const output = generateLorem({ unit: 'paragraphs', count: 4, startWithClassic: false });
    for (const paragraph of output.split('\n\n')) {
      const periodCount = (paragraph.match(/\./g) ?? []).length;
      expect(periodCount).toBeGreaterThanOrEqual(3);
      expect(periodCount).toBeLessThanOrEqual(6);
    }
  });

  it('clamps paragraphs count to LOREM_IPSUM_MAX_PARAGRAPHS', () => {
    const output = generateLorem({
      unit: 'paragraphs',
      count: LOREM_IPSUM_MAX_PARAGRAPHS + 10,
      startWithClassic: false,
    });
    expect(output.split('\n\n')).toHaveLength(LOREM_IPSUM_MAX_PARAGRAPHS);
  });
});

describe('generateLorem — corpus safety', () => {
  it('every emitted word is lowercase (except the first word of each sentence)', () => {
    const output = generateLorem({ unit: 'sentences', count: 10, startWithClassic: false });
    // Split into words, strip trailing `.` / `,`, check everything that
    // is NOT a sentence-start is lowercase.
    const tokens = output.split(/\s+/);
    let lastTerminator = true; // true if previous token ended with `.`
    for (const raw of tokens) {
      if (raw.length === 0) continue;
      const endsSentence = raw.endsWith('.');
      const cleaned = raw.replace(/[.,]$/, '');
      if (cleaned.length === 0) continue;
      if (!lastTerminator) {
        expect(cleaned).toBe(cleaned.toLowerCase());
      }
      lastTerminator = endsSentence;
    }
  });
});
