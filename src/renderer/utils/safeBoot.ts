/**
 * internal — safe-boot detection and crash escalation.
 *
 * The app boots in one of three modes:
 *
 *   - `normal` — default. Restore tabs, recent projects, plugins.
 *   - `safe` — triggered by `?safe-mode=1` query param OR a crash
 *     marker set by `markCrashOnNextBoot()`. Skips session restore,
 *     plugin discovery, and last-project re-open.
 *   - `factory` — triggered when 3 crashes occur within a 60s window.
 *     Strips every localStorage key except `lingua-license` and
 *     forces a minimal recovery surface.
 *
 * The active mode is mirrored on `<html data-recovery-state="...">`
 * so e2e tests and Playwright smokes can inspect the boot state
 * without poking localStorage directly.
 */

const SAFE_MODE_QUERY_PARAM = 'safe-mode';
const SAFE_MODE_KEY = 'lingua-safe-mode';
const CRASH_LOG_KEY = 'lingua-crash-log';
const FACTORY_MODE_KEY = 'lingua-factory-mode';
const PRESERVED_ON_FACTORY = ['lingua-license'] as const;

const FACTORY_CRASH_THRESHOLD = 3;
const FACTORY_CRASH_WINDOW_MS = 60_000;
const RECOVERY_MARK_CLEAR_DELAY_MS = 1_000;

export type RecoveryState = 'normal' | 'safe' | 'factory';

interface RegionalCrashLogEntry {
  timestamp: number;
  region: string;
}

type CrashLogEntry = number | RegionalCrashLogEntry;

let currentBootSawCrash = false;

function safeReadJson<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeWriteJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort; quota / private mode failures are non-fatal.
  }
}

function safeRemove(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function hasSafeModeQueryParam(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(SAFE_MODE_QUERY_PARAM) === '1';
  } catch {
    return false;
  }
}

export function isFactoryMode(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(FACTORY_MODE_KEY) === '1';
}

export function isSafeMode(): boolean {
  if (isFactoryMode()) return true;
  if (hasSafeModeQueryParam()) return true;
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SAFE_MODE_KEY) === '1';
}

export function resolveRecoveryState(): RecoveryState {
  if (isFactoryMode()) return 'factory';
  if (isSafeMode()) return 'safe';
  return 'normal';
}

export function markCrashOnNextBoot(): void {
  currentBootSawCrash = true;
  // Write the raw string (not JSON-stringified) so the `=== '1'`
  // gate in `isSafeMode` matches. JSON.stringify('1') would emit
  // `'"1"'` which would never match.
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SAFE_MODE_KEY, '1');
  } catch {
    // ignore — quota / SecurityError on private mode is non-fatal.
  }
}

export function clearSafeModeMark(): void {
  safeRemove(SAFE_MODE_KEY);
}

/**
 * In-memory fingerprint dedupe so the same crash counted by both the
 * React boundary's `componentDidCatch` AND the global `window.error`
 * listener doesn't bump the boot-loop counter twice. React StrictMode
 * re-throws render errors during the second-pass render, which can
 * dispatch a synthetic `error` event in addition to the boundary's
 * catch path. Without dedupe, three component crashes would escalate
 * to factory mode after only two unique events.
 */
const RECENT_CRASH_FINGERPRINTS = new Map<string, number>();
const FINGERPRINT_DEDUPE_MS = 50;

export function _resetCrashFingerprintsForTests(): void {
  RECENT_CRASH_FINGERPRINTS.clear();
  currentBootSawCrash = false;
}

/**
 * Record a crash in the rolling log. If `FACTORY_CRASH_THRESHOLD`
 * crashes have occurred within `FACTORY_CRASH_WINDOW_MS`, escalate
 * to factory mode. Returns the resulting state so the caller can
 * decide whether to also `markCrashOnNextBoot()`.
 *
 * `fingerprint` is optional. When provided, two `recordCrash` calls
 * with the same fingerprint within `FINGERPRINT_DEDUPE_MS` count as a
 * single crash for the boot-loop counter.
 */
export function recordCrash(
  now: number = Date.now(),
  fingerprint?: string,
  region?: string
): RecoveryState {
  currentBootSawCrash = true;
  if (fingerprint) {
    const last = RECENT_CRASH_FINGERPRINTS.get(fingerprint);
    if (last !== undefined && now - last < FINGERPRINT_DEDUPE_MS) {
      return resolveRecoveryState();
    }
    RECENT_CRASH_FINGERPRINTS.set(fingerprint, now);
    // Best-effort cleanup so the map doesn't grow unbounded over a
    // long session. Ten entries is plenty for the dedupe window.
    if (RECENT_CRASH_FINGERPRINTS.size > 10) {
      const cutoffStamp = now - FINGERPRINT_DEDUPE_MS;
      for (const [key, stamp] of RECENT_CRASH_FINGERPRINTS) {
        if (stamp < cutoffStamp) RECENT_CRASH_FINGERPRINTS.delete(key);
      }
    }
  }

  const log = safeReadJson<CrashLogEntry[]>(CRASH_LOG_KEY) ?? [];
  const cutoff = now - FACTORY_CRASH_WINDOW_MS;
  const recent = log.filter(entry => {
    const timestamp = typeof entry === 'number' ? entry : entry.timestamp;
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  recent.push(region ? { timestamp: now, region } : now);
  safeWriteJson(CRASH_LOG_KEY, recent);

  if (recent.length >= FACTORY_CRASH_THRESHOLD) {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(FACTORY_MODE_KEY, '1');
      } catch {
        // ignore
      }
    }
    return 'factory';
  }

  if (hasSafeModeQueryParam()) return 'safe';
  if (typeof localStorage !== 'undefined' && localStorage.getItem(SAFE_MODE_KEY) === '1') {
    return 'safe';
  }
  return 'normal';
}

/**
 * Build a deterministic-ish fingerprint for a thrown error so the
 * dedupe path above works for both the boundary and the global
 * listener. Caller-side helper; pure module so tests can call it
 * directly.
 */
export function buildCrashFingerprint(error: unknown): string {
  if (!(error instanceof Error)) {
    return `non-error:${typeof error === 'string' ? error.slice(0, 80) : 'unknown'}`;
  }
  const firstFrame = error.stack ? (error.stack.split('\n')[1] ?? '').trim() : '';
  return `${error.name}:${error.message.slice(0, 120)}:${firstFrame.slice(0, 200)}`;
}

/**
 * Wipe everything except keys in `PRESERVED_ON_FACTORY`. Called when
 * the user explicitly invokes "Reset to factory defaults" or when
 * the boot-loop counter trips automatically.
 */
export function applyFactoryReset(): void {
  if (typeof localStorage === 'undefined') return;
  const preserved: Array<[string, string]> = [];
  for (const key of PRESERVED_ON_FACTORY) {
    const value = localStorage.getItem(key);
    if (value !== null) preserved.push([key, value]);
  }
  try {
    localStorage.clear();
  } catch {
    // internal — `clear()` can throw under quota pressure (Firefox
    // private mode, some WebKit builds). Fall through to per-key
    // removal AND skip the preserved keys directly so the license
    // survives even if the post-clear `setItem` re-write fails.
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && !PRESERVED_ON_FACTORY.includes(key as (typeof PRESERVED_ON_FACTORY)[number])) {
        safeRemove(key);
      }
    }
  }
  for (const [key, value] of preserved) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore — preserved key is already in place if `clear()` threw
      // (we skipped it in the per-key fallback above).
    }
  }
}

/**
 * Clear the factory + safe-mode marks. Called once the renderer has
 * mounted cleanly past its first frame.
 */
export function clearRecoveryMarks(): void {
  safeRemove(SAFE_MODE_KEY);
  safeRemove(CRASH_LOG_KEY);
  safeRemove(FACTORY_MODE_KEY);
  currentBootSawCrash = false;
}

/**
 * Clear stale recovery marks once the current boot proves it can render
 * without recording a fresh crash. A previous crash should force the next
 * boot into safe mode, but it should not trap the user there forever.
 */
export function clearRecoveryMarksIfCurrentBootClean(): boolean {
  if (currentBootSawCrash) return false;
  clearRecoveryMarks();
  return true;
}

export function scheduleRecoveryMarksClear(delayMs: number = RECOVERY_MARK_CLEAR_DELAY_MS): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    if (clearRecoveryMarksIfCurrentBootClean()) {
      applyRecoveryStateAttr(resolveRecoveryState());
    }
  }, delayMs);
}

/**
 * Mirror the recovery state on `<html data-recovery-state="...">` so
 * tests + smokes can inspect without poking localStorage.
 */
export function applyRecoveryStateAttr(state: RecoveryState): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.recoveryState = state;
}
