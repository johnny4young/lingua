/**
 * Web-build device fingerprint helpers — RL-061 Slice 2.5.
 *
 * The desktop bridge owns the device id on disk
 * (`device-id.json` under `app.getPath('userData')`, see
 * `src/main/license.ts`). The web build has no equivalent persistent
 * store, so we mint a UUID once on first paste and persist it in
 * `localStorage` keyed by `lingua-device-id`. The id never rotates
 * for a given browser profile — clearing site data wipes it and the
 * next paste mints a fresh one (server is idempotent on
 * `(license_id, device_id, surface)` so that does not double-count).
 *
 * `deviceName` and `os` are derived from `navigator.userAgent` and
 * platform hints. They are display-only fields the user sees in
 * Settings → License (Slice 3) — never used as authentication
 * material. The server stores them as free-form text.
 *
 * Per LICENSING_ADR Decision 4 + Decision 6 (web licensing model).
 */

const STORAGE_KEY = 'lingua-device-id';
let sessionDeviceId: string | null = null;

/**
 * Mint-once accessor for the web device id. Reads from
 * `localStorage`; if absent or malformed, mints a fresh
 * UUID and writes it back. If storage is blocked, keeps one
 * module-scoped id for the tab so activate/status/clear all refer to
 * the same server-side device. SSR-safe — returns a stable empty
 * string only when Web Crypto is unavailable.
 */
export function getOrMintDeviceId(): string {
  const minted = mintUuid();
  if (!minted) {
    return '';
  }

  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return getOrSetSessionDeviceId(minted);
  }

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (typeof existing === 'string' && isLikelyUuid(existing)) {
      sessionDeviceId = existing;
      return existing;
    }
  } catch {
    // localStorage can throw in privacy-mode browsers; fall through
    // to a session-scoped id instead of crashing the paste flow.
    return getOrSetSessionDeviceId(minted);
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, minted);
  } catch {
    // Same privacy-mode story. Keep a module-scoped session id so
    // activate/status/clear all reference the same device while the
    // tab lives; otherwise clearLicense would remove a different
    // server row from the one setLicenseToken registered.
    return getOrSetSessionDeviceId(minted);
  }
  sessionDeviceId = minted;
  return minted;
}

/**
 * Derive a human-readable device name from `navigator.userAgent` for
 * the Settings → License device list (Slice 3). Falls back to
 * generic placeholders when UA strings are unrecognisable so the
 * server never receives empty or shell-injection-bait values.
 */
export function getDeviceName(): string {
  const ua = readUserAgent();
  const browser = detectBrowserFamily(ua);
  const os = detectPlatformLabel(ua);
  if (!browser && !os) return 'Web browser';
  if (!browser) return `Browser on ${os}`;
  if (!os) return browser;
  return `${browser} on ${os}`;
}

/**
 * Return the os identifier sent to the server in
 * `POST /licenses/activate`. Format: `web-${browserFamily}` so the
 * desktop bucket counters never collide with browser-specific
 * web entries (Chrome and Firefox would both surface as `'web'`
 * without the suffix). Falls back to `'web-unknown'` when UA
 * detection fails.
 */
export function getOs(): string {
  const ua = readUserAgent();
  const browser = detectBrowserFamily(ua);
  return browser ? `web-${browser.toLowerCase()}` : 'web-unknown';
}

// ----------------------------------------------------------------- helpers

function readUserAgent(): string {
  if (typeof navigator === 'undefined') return '';
  return typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
}

function detectBrowserFamily(ua: string): string | null {
  if (!ua) return null;
  // Order matters — Edge sends "Chrome" too, Brave sends "Chrome" and
  // "Safari", Opera sends "Chrome" and "Opera" (or "OPR"). Match the
  // most-specific brand first.
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua) || /Opera\//i.test(ua)) return 'Opera';
  if (/Brave\//i.test(ua)) return 'Brave';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) return 'Chrome';
  if (/Chromium\//i.test(ua)) return 'Chromium';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return null;
}

function detectPlatformLabel(ua: string): string | null {
  if (!ua) return null;
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua) || /Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'Linux';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  return null;
}

function isLikelyUuid(value: string): boolean {
  // Loose UUID v4 / v7 / random-UUID shape — `crypto.randomUUID`
  // always emits this. We don't enforce the version digit so a
  // user pasting a different UUID format manually won't break.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getOrSetSessionDeviceId(candidate: string): string {
  if (sessionDeviceId && isLikelyUuid(sessionDeviceId)) return sessionDeviceId;
  sessionDeviceId = candidate;
  return sessionDeviceId;
}

function mintUuid(): string | null {
  const cryptoLike = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  if (!cryptoLike) return null;
  if (typeof cryptoLike.randomUUID === 'function') {
    return cryptoLike.randomUUID();
  }
  if (typeof cryptoLike.getRandomValues !== 'function') {
    return null;
  }

  const bytes = cryptoLike.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/**
 * Test-only — clears the persisted id so each test starts from a
 * clean state. Production code never calls this. Exported under a
 * `__test__` namespace name so casual `Cmd+Shift+F` for "clear" in
 * Settings UI doesn't surface it as a candidate to wire up.
 */
export function __testClearDeviceId(): void {
  sessionDeviceId = null;
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* swallow — same privacy-mode reason */
  }
}
