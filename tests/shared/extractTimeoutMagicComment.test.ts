import { describe, expect, it } from 'vitest';
import { extractTimeoutMagicComment } from '../../src/renderer/utils/magicComments';

describe('implementation note — extractTimeoutMagicComment', () => {
  it('reads a bare-integer directive as seconds', () => {
    expect(extractTimeoutMagicComment('javascript', '// @timeout 5')).toBe(
      5_000
    );
    expect(extractTimeoutMagicComment('typescript', '// @timeout 30')).toBe(
      30_000
    );
  });

  it('honors explicit seconds suffix', () => {
    expect(extractTimeoutMagicComment('javascript', '// @timeout 5s')).toBe(
      5_000
    );
    expect(
      extractTimeoutMagicComment('javascript', '// @timeout 10 seconds')
    ).toBe(10_000);
  });

  it('parses ms suffix as milliseconds', () => {
    expect(
      extractTimeoutMagicComment('javascript', '// @timeout 250ms')
    ).toBe(250);
    expect(
      extractTimeoutMagicComment('typescript', '// @timeout 1500 millis')
    ).toBe(1500);
  });

  it('parses minute suffix as minutes', () => {
    expect(extractTimeoutMagicComment('javascript', '// @timeout 2m')).toBe(
      120_000
    );
    expect(
      extractTimeoutMagicComment('javascript', '// @timeout 1 min')
    ).toBe(60_000);
    expect(
      extractTimeoutMagicComment('javascript', '// @timeout 3 minutes')
    ).toBe(180_000);
  });

  it('uses the Python comment syntax for python', () => {
    expect(extractTimeoutMagicComment('python', '# @timeout 5')).toBe(5_000);
    expect(
      extractTimeoutMagicComment('python', '# @timeout 90s\nprint("hi")')
    ).toBe(90_000);
  });

  it('returns null when no directive is present', () => {
    expect(extractTimeoutMagicComment('javascript', 'console.log("hi")')).toBe(
      null
    );
    expect(extractTimeoutMagicComment('python', '')).toBe(null);
  });

  it('caps at the extended preset ceiling (10 min)', () => {
    expect(
      extractTimeoutMagicComment('javascript', '// @timeout 99999s')
    ).toBe(600_000);
  });

  it('rejects unsupported languages', () => {
    expect(extractTimeoutMagicComment('go', '// @timeout 5s')).toBe(null);
    expect(extractTimeoutMagicComment('rust', '// @timeout 5s')).toBe(null);
    expect(extractTimeoutMagicComment('json', '// @timeout 5s')).toBe(null);
  });

  it('rejects non-positive values', () => {
    expect(extractTimeoutMagicComment('javascript', '// @timeout 0')).toBe(
      null
    );
    expect(
      extractTimeoutMagicComment('javascript', '// @timeout -5')
    ).toBe(null);
  });

  it('takes the FIRST matching directive when several exist', () => {
    const code = '// @timeout 5\nconsole.log(1)\n// @timeout 60';
    expect(extractTimeoutMagicComment('javascript', code)).toBe(5_000);
  });
});
