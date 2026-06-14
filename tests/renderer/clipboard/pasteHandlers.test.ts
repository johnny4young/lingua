import { describe, expect, it } from 'vitest';
import { detectPasteIntent } from '@/clipboard/pasteHandlers';
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
