/**
 * Unit tests for the RL-061 Slice 2.5 web-side device fingerprint
 * helpers. All three exports (`getOrMintDeviceId`, `getDeviceName`,
 * `getOs`) are derived from `localStorage` + `navigator.userAgent`,
 * so the tests just stub those globals and pin the contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __testClearDeviceId,
  getDeviceName,
  getOrMintDeviceId,
  getOs,
} from '../../src/renderer/services/deviceFingerprint';

function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
}

beforeEach(() => {
  __testClearDeviceId();
});

afterEach(() => {
  __testClearDeviceId();
  vi.restoreAllMocks();
});

describe('getOrMintDeviceId', () => {
  it('mints a UUID on first call and persists it under the lingua-device-id key', () => {
    const id = getOrMintDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(window.localStorage.getItem('lingua-device-id')).toBe(id);
  });

  it('returns the same UUID on subsequent calls (mint-once invariant — server tracks per device)', () => {
    const first = getOrMintDeviceId();
    const second = getOrMintDeviceId();
    const third = getOrMintDeviceId();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('replaces a malformed stored value with a fresh UUID instead of returning garbage', () => {
    window.localStorage.setItem('lingua-device-id', 'not-a-uuid');
    const id = getOrMintDeviceId();
    expect(id).not.toBe('not-a-uuid');
    expect(id).toMatch(/^[0-9a-f]{8}-/i);
    expect(window.localStorage.getItem('lingua-device-id')).toBe(id);
  });

  it('keeps one session-scoped UUID when localStorage reads throw in privacy mode', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const first = getOrMintDeviceId();
    const second = getOrMintDeviceId();

    expect(first).toMatch(/^[0-9a-f]{8}-/i);
    expect(second).toBe(first);
  });

  it('keeps one session-scoped UUID when localStorage writes fail after minting', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    const first = getOrMintDeviceId();
    const second = getOrMintDeviceId();

    expect(first).toMatch(/^[0-9a-f]{8}-/i);
    expect(second).toBe(first);
  });
});

describe('getDeviceName', () => {
  // UA strings sampled from real Chromium browsers — keeps the
  // detection regexes from drifting silently as browsers ship new
  // user-agent reductions.
  it('formats Chrome on macOS', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    expect(getDeviceName()).toBe('Chrome on macOS');
  });

  it('formats Firefox on Windows', () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
    );
    expect(getDeviceName()).toBe('Firefox on Windows');
  });

  it('formats Safari on macOS — does NOT collide with Chrome which also includes Safari/...', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    );
    expect(getDeviceName()).toBe('Safari on macOS');
  });

  it('formats Edge on Windows ahead of the Chrome family check', () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
    );
    expect(getDeviceName()).toBe('Edge on Windows');
  });

  it('falls back to a generic label when the UA is unparsable', () => {
    setUserAgent('UnknownBot/1.0');
    expect(getDeviceName()).toBe('Web browser');
  });
});

describe('getOs', () => {
  it('emits web-chrome / web-firefox / web-safari prefixed labels so the desktop bucket never collides', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    expect(getOs()).toBe('web-chrome');

    setUserAgent('Mozilla/5.0 (Windows NT 10.0; rv:120.0) Gecko/20100101 Firefox/120.0');
    expect(getOs()).toBe('web-firefox');
  });

  it('returns web-unknown when no browser family matches — defends against the server seeing empty `os`', () => {
    setUserAgent('UnknownBot/1.0');
    expect(getOs()).toBe('web-unknown');
  });

  /**
   * Contract guard between renderer and worker validator. Every value
   * the renderer emits MUST satisfy the worker's `OS_PATTERN` regex
   * (lowercase letters/digits with optional internal hyphens, capped at
   * 64 bytes). If either side drifts, this test fails — and so does
   * the worker-side `accepts the web build OS string family` test in
   * `license-server/test/{licenses,trials}.test.ts`. Two-sided
   * assertion so a regression on either codebase is caught without
   * needing a full end-to-end run.
   *
   * Source-of-truth pattern lives in
   * `license-server/src/lib/validation.ts:OS_PATTERN`. If you change
   * one, change both.
   */
  const OS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
  const MAX_OS_LENGTH = 64;

  it.each([
    [
      'Chrome on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
    ['Firefox on Windows', 'Mozilla/5.0 (Windows NT 10.0; rv:120.0) Gecko/20100101 Firefox/120.0'],
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    ],
    [
      'Edge on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    ],
    [
      'Opera',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 OPR/104.0.0.0',
    ],
    [
      'Brave',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Brave/1.60 Chrome/120.0.0.0 Safari/537.36',
    ],
    ['Chromium', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/120.0.0.0 Safari/537.36'],
    ['UnknownBot', 'UnknownBot/1.0'],
    ['empty UA', ''],
  ])('getOs() output for %s satisfies the worker OS_PATTERN contract', (_label, ua) => {
    setUserAgent(ua);
    const os = getOs();
    expect(os.length).toBeGreaterThan(0);
    expect(os.length).toBeLessThanOrEqual(MAX_OS_LENGTH);
    expect(os).toMatch(OS_PATTERN);
  });
});
