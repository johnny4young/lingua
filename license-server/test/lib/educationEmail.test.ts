/**
 * Unit tests for the educational-email validator (RL-061 Slice 4).
 *
 * Pin the regex positives + negatives plus the additional TLD
 * allow-list so a maintainer extending it doesn't accidentally
 * widen the gate beyond intent.
 */

import { describe, expect, it } from 'vitest';
import { isEducationalEmail } from '../../src/lib/educationEmail';

describe('isEducationalEmail', () => {
  it.each([
    'me@stanford.edu',
    'student@cs.stanford.edu',
    'me@oxford.ac.uk',
    'me@unam.edu.mx',
    'me@unsw.edu.au',
    'me@toronto.edu.ca',
    'me@usp.edu.br',
    'me@iitb.ac.in',
    'STUDENT@MIT.EDU', // case-insensitive
    'student.with.dots@cs.berkeley.edu',
    '  spaces.around@school.edu  ', // trim
  ])('accepts educational address: %s', (input) => {
    expect(isEducationalEmail(input).ok).toBe(true);
  });

  it.each([
    'me@gmail.com',
    'me@hotmail.com',
    'me@example.org',
    'me@example.co.uk', // .co.uk is consumer not educational
    'me@example.edu.uk', // not in allow-list
    'me@edu.com', // edu before .com — not a TLD
    'me@school.eduu', // typo — must be exact tld
    'no-at-sign',
    '',
    '   ',
    '@school.edu', // missing local part
    'student@', // missing domain
    'me@ac.uk', // domain too short — needs subdomain before tld
    'me@edu.mx', // same — needs subdomain
  ])('rejects non-educational address: %s', (input) => {
    expect(isEducationalEmail(input).ok).toBe(false);
  });

  it('reports the matched suffix for diagnostics', () => {
    expect(isEducationalEmail('me@stanford.edu')).toEqual({ ok: true, matched: 'edu' });
    expect(isEducationalEmail('me@oxford.ac.uk')).toEqual({ ok: true, matched: 'ac.uk' });
    expect(isEducationalEmail('me@unam.edu.mx')).toEqual({ ok: true, matched: 'edu.mx' });
  });

  it('does not throw on non-string inputs', () => {
    expect(isEducationalEmail(null as unknown as string).ok).toBe(false);
    expect(isEducationalEmail(undefined as unknown as string).ok).toBe(false);
    expect(isEducationalEmail(42 as unknown as string).ok).toBe(false);
  });
});
