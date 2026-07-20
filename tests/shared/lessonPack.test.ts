/**
 * implementation — `LessonPackV1` schema + parser tests.
 *
 * Pins:
 *   - The closed-enum surfaces (`LESSON_REJECT_REASONS`,
 *     `ASSERTION_EXIT_KINDS`).
 *   - The happy parse path for an in-memory object + a JSON string.
 *   - Every reject reason via a focused malformed input.
 *   - Locale fallback via `pickProse` (es → en when es missing).
 *   - `previewPromptLine` truncation + markdown stripping.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSERTION_EXIT_KINDS,
  LESSON_REJECT_REASONS,
  MAX_ASSERTION_CODE_LENGTH,
  MAX_LESSON_PACK_BYTES,
  parseLessonPack,
  pickProse,
  previewPromptLine,
  type LessonPackV1,
} from '../../src/shared/lessonPack';

const VALID_RECIPE: LessonPackV1 = {
  version: 1,
  id: 'js-test',
  language: 'javascript',
  title: { en: 'Test recipe', es: 'Receta de prueba' },
  prompt: { en: 'Solve it.', es: 'Resuélvelo.' },
  starterCode: 'const result = 42;',
  assertions: [
    {
      id: 'returns-42',
      name: { en: 'Returns 42', es: 'Devuelve 42' },
      kind: 'value',
      code: 'result === 42',
    },
  ],
  tags: ['arrays', 'sort'],
};

describe('LESSON_REJECT_REASONS', () => {
  it('exposes the full closed-enum surface', () => {
    expect([...LESSON_REJECT_REASONS].sort()).toEqual([
      'invalid-shape',
      'malformed-json',
      'oversized',
      'unknown-language',
      'wrong-version',
    ]);
  });
});

describe('ASSERTION_EXIT_KINDS', () => {
  it('exposes the closed-enum kinds', () => {
    expect([...ASSERTION_EXIT_KINDS].sort()).toEqual([
      'console-contains',
      'throw',
      'value',
    ]);
  });
});

describe('parseLessonPack', () => {
  it('accepts a valid in-memory object', () => {
    const outcome = parseLessonPack(VALID_RECIPE);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.pack.id).toBe('js-test');
      expect(outcome.pack.assertions[0]?.id).toBe('returns-42');
    }
  });

  it('accepts a valid JSON string', () => {
    const outcome = parseLessonPack(JSON.stringify(VALID_RECIPE));
    expect(outcome.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const outcome = parseLessonPack('{not json');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('malformed-json');
  });

  it('rejects wrong version', () => {
    const outcome = parseLessonPack({ ...VALID_RECIPE, version: 2 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('wrong-version');
  });

  it('rejects unknown language', () => {
    const outcome = parseLessonPack({ ...VALID_RECIPE, language: 'klingon' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('unknown-language');
  });

  it('rejects oversized JSON input', () => {
    const huge = ' '.repeat(MAX_LESSON_PACK_BYTES + 1);
    const outcome = parseLessonPack(`"${huge}"`);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('oversized');
  });

  it('rejects assertion with oversized code', () => {
    const oversized: LessonPackV1 = {
      ...VALID_RECIPE,
      assertions: [
        {
          id: 'oversized',
          name: { en: 'Oversized' },
          kind: 'value',
          code: 'x'.repeat(MAX_ASSERTION_CODE_LENGTH + 1),
        },
      ],
    };
    const outcome = parseLessonPack(oversized);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('invalid-shape');
  });

  it('rejects duplicate assertion ids', () => {
    const dup: LessonPackV1 = {
      ...VALID_RECIPE,
      assertions: [
        { id: 'dup', name: { en: 'A' }, kind: 'value', code: 'true' },
        { id: 'dup', name: { en: 'B' }, kind: 'value', code: 'true' },
      ],
    };
    const outcome = parseLessonPack(dup);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('invalid-shape');
  });

  it('rejects empty assertions array', () => {
    const outcome = parseLessonPack({ ...VALID_RECIPE, assertions: [] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('invalid-shape');
  });

  it('rejects missing title.en', () => {
    const outcome = parseLessonPack({
      ...VALID_RECIPE,
      title: { es: 'Solo español' } as unknown as LessonPackV1['title'],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('invalid-shape');
  });

  it('rejects tag with whitespace', () => {
    const outcome = parseLessonPack({
      ...VALID_RECIPE,
      tags: ['has whitespace'],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('invalid-shape');
  });

  it('returns invalid-shape for non-object input', () => {
    expect(parseLessonPack(null).ok).toBe(false);
    expect(parseLessonPack(42).ok).toBe(false);
    expect(parseLessonPack([VALID_RECIPE]).ok).toBe(false);
  });
});

describe('pickProse', () => {
  it('returns es when present', () => {
    expect(pickProse({ en: 'Hello', es: 'Hola' }, 'es')).toBe('Hola');
  });

  it('falls back to en when es is missing', () => {
    expect(pickProse({ en: 'Hello' }, 'es')).toBe('Hello');
  });

  it('returns en for en locale', () => {
    expect(pickProse({ en: 'Hello', es: 'Hola' }, 'en')).toBe('Hello');
  });
});

describe('previewPromptLine', () => {
  it('strips markdown markers and collapses whitespace', () => {
    const preview = previewPromptLine(
      { en: '# Heading\n\n**Bold** and `code`.\n\nSecond paragraph.' },
      'en',
      80
    );
    expect(preview).toBe('Heading');
  });

  it('truncates with ellipsis past maxChars', () => {
    const preview = previewPromptLine({ en: 'a'.repeat(100) }, 'en', 20);
    expect(preview.length).toBeLessThanOrEqual(20);
    expect(preview.endsWith('…')).toBe(true);
  });
});
