import { beforeEach, describe, expect, it } from 'vitest';
import { recordExplainRating } from '../../../src/renderer/utils/explainRatings';

const stored = () => JSON.parse(localStorage.getItem('lingua-explain-ratings') ?? '[]') as { kind: string; vote: string }[];

beforeEach(() => localStorage.clear());

describe('explain ratings', () => {
  it('keeps the error kind and the vote, never the message', () => {
    recordExplainRating('helpful', "TypeError: Cannot read properties of null (reading 'secretField')", 5);
    recordExplainRating('not-helpful', 'something odd happened', 6);
    expect(stored()).toEqual([
      { at: 5, kind: 'TypeError', vote: 'helpful' },
      { at: 6, kind: 'other', vote: 'not-helpful' },
    ]);
    expect(localStorage.getItem('lingua-explain-ratings')).not.toContain('secretField');
  });

  it('keeps the last hundred votes', () => {
    for (let index = 0; index < 105; index += 1) recordExplainRating('helpful', 'NameError: x', index);
    expect(stored()).toHaveLength(100);
    expect((stored()[0] as unknown as { at: number }).at).toBe(5);
  });
});
