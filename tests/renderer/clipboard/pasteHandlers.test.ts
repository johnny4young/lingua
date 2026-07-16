import { describe, expect, it } from 'vitest';
import { detectPasteIntent } from '@/clipboard/pasteHandlers';
import { NON_SECRET_TEST_JWT } from '../../__fixtures__/jwt';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';

/**
 * RL-110 — locks the pure paste-intent detectors. Each must fire on the real
 * artifact (reusing the shipped parsers) and, critically, NEVER fire on the
 * look-alikes that show up in normal code (the conservative "must NOT fire"
 * suite is the whole point of shipping detection that mutates the buffer).
 */
const SHARE_LINK = 'https://linguacode.dev/#share=v1.H4sIAAAAAAAAA0vLz9cDAGmQ3hcEAAAA';
const CAPSULE_JSON = JSON.stringify(FIXTURE_MINIMAL_JS);
const CURL = "curl -X POST https://api.example.com/v1/users -H 'Content-Type: application/json' -d '{\"name\":\"a\"}'";
const STACK_TRACE = [
  'Error: boom',
  '    at handler (/Users/dev/app/src/handler.js:42:15)',
  '    at main (/Users/dev/app/src/index.js:10:3)',
].join('\n');
const LARGE_JSON = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row-${i}` })) });

describe('detectPasteIntent — positive detection', () => {
  it('detects a Lingua share link and extracts the fragment', () => {
    const intent = detectPasteIntent(SHARE_LINK);
    expect(intent?.kind).toBe('share-link');
    expect(intent?.kind === 'share-link' && intent.fragment.startsWith('share=v1.')).toBe(true);
  });

  it('detects a RunCapsule JSON', () => {
    const intent = detectPasteIntent(CAPSULE_JSON);
    expect(intent?.kind).toBe('capsule');
  });

  it('detects a cURL command', () => {
    const intent = detectPasteIntent(CURL);
    expect(intent?.kind).toBe('curl');
  });

  it('detects a stack trace and parses the first frame', () => {
    const intent = detectPasteIntent(STACK_TRACE);
    expect(intent?.kind).toBe('stack-trace');
    if (intent?.kind === 'stack-trace') {
      expect(intent.file).toBe('/Users/dev/app/src/handler.js');
      expect(intent.line).toBe(42);
      expect(intent.column).toBe(15);
    }
  });

  it('detects a large JSON blob over 1 KB', () => {
    expect(LARGE_JSON.length).toBeGreaterThan(1024);
    expect(detectPasteIntent(LARGE_JSON)?.kind).toBe('large-json');
  });

  it('prefers the capsule handler over large-json for a RunCapsule', () => {
    // A capsule is also valid large JSON; capsule must win (runs first).
    expect(detectPasteIntent(CAPSULE_JSON)?.kind).toBe('capsule');
  });
});

describe('detectPasteIntent — IT2-F4 utility suggestions', () => {
  function expectUtility(text: string, utilityId: string) {
    const intent = detectPasteIntent(text);
    expect(intent?.kind).toBe('utility');
    if (intent?.kind === 'utility') {
      expect(intent.utilityId).toBe(utilityId);
      expect(intent.source).toBe(text.trim());
    }
  }

  it('suggests the JWT debugger for a three-segment token', () => {
    expectUtility(NON_SECRET_TEST_JWT, 'jwt');
  });

  it('suggests the JWT debugger over Base64 (segments are base64url)', () => {
    expect(detectPasteIntent(NON_SECRET_TEST_JWT)?.kind === 'utility').toBe(true);
    const intent = detectPasteIntent(NON_SECRET_TEST_JWT);
    if (intent?.kind === 'utility') expect(intent.utilityId).toBe('jwt');
  });

  it('suggests the UUID tool for a canonical UUID', () => {
    expectUtility('3f2b6e0a-9c1d-4b7e-8f3a-2d5c8e9b0a1f', 'uuid');
  });

  it('suggests the color converter for #hex and rgb() values', () => {
    expectUtility('#4f46e5', 'color');
    expectUtility('rgb(79, 70, 229)', 'color');
  });

  it('suggests the timestamp converter for human-range epochs', () => {
    expectUtility('1700000000', 'timestamp');
    expectUtility('1700000000000', 'timestamp');
  });

  it('suggests the cron parser for real schedules and macros', () => {
    expectUtility('*/5 * * * *', 'cron-parser');
    expectUtility('0 9 * * 1-5', 'cron-parser');
    expectUtility('@daily', 'cron-parser');
  });

  it('suggests the Base64 tool when the decode is readable text', () => {
    // btoa('hello world, this is lingua')
    expectUtility('aGVsbG8gd29ybGQsIHRoaXMgaXMgbGluZ3Vh', 'base64');
  });

  it('suggests the JSON formatter for a non-trivial strict-JSON snippet', () => {
    const snippet = JSON.stringify({
      name: 'Lingua',
      tools: ['json', 'base64'],
      version: 2,
      active: true,
    });
    expect(snippet.length).toBeGreaterThanOrEqual(60);
    expect(snippet.length).toBeLessThan(1024);
    expectUtility(snippet, 'json');
  });

  it('keeps large-json ownership of blobs over the 1 KB floor', () => {
    expect(detectPasteIntent(LARGE_JSON)?.kind).toBe('large-json');
  });
});

describe('detectPasteIntent — IT2-F4 must NOT fire on code look-alikes', () => {
  it('ignores JS duration arithmetic that matches the cron shape', () => {
    expect(detectPasteIntent('5 * 60 * 1000')).toBeNull();
    expect(detectPasteIntent('24 * 60 * 60 * 1000')).toBeNull();
    expect(detectPasteIntent('60 * 60 * 1000')).toBeNull();
  });

  it('ignores hex hashes that satisfy the Base64 shape but decode to binary', () => {
    expect(detectPasteIntent('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3')).toBeNull();
    expect(detectPasteIntent('deadbeefdeadbeef')).toBeNull();
  });

  it('ignores bare hex without the # prefix (id fragments, not colors)', () => {
    expect(detectPasteIntent('4f46e5')).toBeNull();
  });

  it('ignores numbers outside the human epoch range or of other widths', () => {
    expect(detectPasteIntent('9999999999')).toBeNull();
    expect(detectPasteIntent('12345')).toBeNull();
    expect(detectPasteIntent('1234567890123456')).toBeNull();
  });

  it('ignores unquoted object literals and trivial strict JSON', () => {
    expect(detectPasteIntent('{a: 1, b: 2}')).toBeNull();
    expect(detectPasteIntent('{"a":1}')).toBeNull();
  });

  it('ignores ordinary code lines', () => {
    expect(detectPasteIntent('const response = await fetch(url);')).toBeNull();
    expect(detectPasteIntent('color = value * alpha / 255')).toBeNull();
  });
});

describe('detectPasteIntent — must NOT fire (false-positive guards)', () => {
  it('ignores empty / whitespace input', () => {
    expect(detectPasteIntent('')).toBeNull();
    expect(detectPasteIntent('   \n  ')).toBeNull();
  });

  it('ignores a JS string literal that merely contains the word curl', () => {
    expect(detectPasteIntent('const cmd = "curl https://x.com";')).toBeNull();
  });

  it('ignores a non-share URL', () => {
    expect(detectPasteIntent('https://github.com/anthropics/lingua')).toBeNull();
  });

  it('ignores a share fragment with an empty body', () => {
    expect(detectPasteIntent('https://linguacode.dev/#share=v1.')).toBeNull();
  });

  it('ignores JSON that is not a RunCapsule and under the large-JSON floor', () => {
    expect(detectPasteIntent('{"version":2,"foo":1}')).toBeNull();
    expect(detectPasteIntent('{"a":1,"b":2}')).toBeNull();
  });

  it('ignores prose with a colon-number-number substring but no stack frame', () => {
    expect(detectPasteIntent('See line 42:15 for the failing assertion.')).toBeNull();
  });

  it('ignores a multi-token line that contains a share fragment in prose', () => {
    expect(
      detectPasteIntent('Check this out https://linguacode.dev/#share=v1.abc and tell me')
    ).toBeNull();
  });

  it('ignores non-JS prose', () => {
    expect(detectPasteIntent('the quick brown fox jumps over the lazy dog')).toBeNull();
  });
});
