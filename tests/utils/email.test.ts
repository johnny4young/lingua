import { describe, expect, it } from 'vitest';
import { isLikelyEmail } from '../../src/renderer/utils/email';

describe('isLikelyEmail (SR-39)', () => {
  it('accepts ordinary and unusual-but-valid addresses', () => {
    for (const value of [
      'ada@example.com',
      'ada.lovelace+trial@sub.example.co.uk',
      'user_name@school.edu',
      '  spaced@example.com  ',
    ]) {
      expect(isLikelyEmail(value)).toBe(true);
    }
  });

  it('rejects obviously malformed values', () => {
    for (const value of [
      '',
      'ada',
      'ada@',
      '@example.com',
      'ada@example',
      'ada@@example.com',
      'ada example@x.com',
    ]) {
      expect(isLikelyEmail(value)).toBe(false);
    }
  });
});
