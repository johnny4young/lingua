import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertUnicodeCapture, nativeOutputCap, unicodeFixture } from '../../scripts/lib/nativeOutputSmoke.mjs';

function expected(stream: 'stdout' | 'stderr') {
  const marker = `\n[${stream} truncated]`;
  const room = nativeOutputCap - Buffer.byteLength(marker);
  // Independent code-point iteration instead of the smoke helper's arithmetic.
  let prefix = '';
  let bytes = 0;
  for (const character of '漢😀'.repeat(Math.ceil(room / 7))) {
    const size = Buffer.byteLength(character);
    if (bytes + size > room) break;
    prefix += character;
    bytes += size;
  }
  return prefix + marker;
}

describe('native output app smoke assertions', () => {
  const valid = { stdout: expected('stdout'), stderr: expected('stderr') };
  it('accepts bounded exact captures on both independent pipes', () => {
    expect(() => assertUnicodeCapture(valid)).not.toThrow();
  });
  it.each(['stdout', 'stderr'] as const)('rejects legacy UTF-16-sized %s output', stream => {
    expect(() => assertUnicodeCapture({ ...valid, [stream]: '漢😀'.repeat(200_000) })).toThrow();
  });
  it('rejects a missing marker and corrupted code-point boundary', () => {
    expect(() => assertUnicodeCapture({ ...valid, stdout: valid.stdout.slice(0, -1) })).toThrow();
    expect(() => assertUnicodeCapture({ ...valid, stderr: '\uFFFD' + valid.stderr.slice(1) })).toThrow();
  });
  it('can inspect stdout alone while stderr carries Stop readiness', () => {
    expect(() => assertUnicodeCapture({ ...valid, stderr: 'READY\n' }, ['stdout'])).not.toThrow();
  });
  it('keeps fixture output finite and readiness behind the stdout write callback', () => {
    expect(unicodeFixture(false)).toContain('process.stderr.write(text)');
    expect(unicodeFixture(false)).not.toContain('setInterval');
    expect(unicodeFixture(true)).toContain('process.stdout.write(text, () => {');
    expect(unicodeFixture(true)).toContain('process.stderr.write("READY\\n")');
  });
  it('uses the product budget instead of allowing a stale smoke-only cap', () => {
    const source = readFileSync(resolve(__dirname, '../../src/shared/runnerLimits.ts'), 'utf8');
    expect(source).toContain('MAX_NATIVE_STDERR_BYTES = 1024 * 1024');
    expect(nativeOutputCap).toBe(1024 * 1024);
  });
});
