/**
 * @vitest-environment jsdom
 *
 * RL-090 — safe-boot helpers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetCrashFingerprintsForTests,
  applyFactoryReset,
  applyRecoveryStateAttr,
  buildCrashFingerprint,
  clearRecoveryMarks,
  clearRecoveryMarksIfCurrentBootClean,
  clearSafeModeMark,
  isFactoryMode,
  isSafeMode,
  markCrashOnNextBoot,
  recordCrash,
  resolveRecoveryState,
} from '@/utils/safeBoot';

const LICENSE_KEY = 'lingua-license';
const SETTINGS_KEY = 'lingua-settings';

function setQueryString(query: string): void {
  // jsdom locks down `window.location` properties; replace the whole
  // location object on a writable descriptor so the safeBoot helper
  // sees the desired search string.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, search: query, href: `http://localhost/${query}` },
  });
}

describe('safeBoot — query param + crash marker detection', () => {
  beforeEach(() => {
    localStorage.clear();
    setQueryString('');
    delete document.documentElement.dataset.recoveryState;
  });

  afterEach(() => {
    localStorage.clear();
    setQueryString('');
    delete document.documentElement.dataset.recoveryState;
  });

  it('isSafeMode is false on a clean boot', () => {
    expect(isSafeMode()).toBe(false);
    expect(resolveRecoveryState()).toBe('normal');
  });

  it('isSafeMode true when ?safe-mode=1 is present', () => {
    setQueryString('?safe-mode=1');
    expect(isSafeMode()).toBe(true);
    expect(resolveRecoveryState()).toBe('safe');
  });

  it('isSafeMode true when the localStorage crash mark is set', () => {
    markCrashOnNextBoot();
    expect(isSafeMode()).toBe(true);
    expect(resolveRecoveryState()).toBe('safe');
  });

  it('clearSafeModeMark removes the localStorage mark', () => {
    markCrashOnNextBoot();
    clearSafeModeMark();
    expect(isSafeMode()).toBe(false);
  });
});

describe('safeBoot — boot-loop counter escalates to factory mode', () => {
  beforeEach(() => {
    localStorage.clear();
    setQueryString('');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('two crashes within the window stay in safe mode', () => {
    expect(recordCrash(1_000)).toBe('normal');
    expect(recordCrash(2_000)).toBe('normal');
    expect(isFactoryMode()).toBe(false);
  });

  it('three crashes within 60s escalates to factory mode', () => {
    expect(recordCrash(1_000)).toBe('normal');
    expect(recordCrash(2_000)).toBe('normal');
    expect(recordCrash(3_000)).toBe('factory');
    expect(isFactoryMode()).toBe(true);
    expect(resolveRecoveryState()).toBe('factory');
  });

  it('crashes outside the 60s window do not count toward the threshold', () => {
    expect(recordCrash(1_000)).toBe('normal');
    expect(recordCrash(2_000)).toBe('normal');
    // 60_001 ms after the second crash — first two are pruned.
    expect(recordCrash(62_001)).toBe('normal');
    expect(isFactoryMode()).toBe(false);
  });

  it('records regional metadata without breaking legacy timestamp entries', () => {
    localStorage.setItem('lingua-crash-log', JSON.stringify([1_000]));

    expect(recordCrash(2_000, 'TypeError:boom:workspace.tsx:1:1', 'notebook')).toBe('normal');
    const log = JSON.parse(localStorage.getItem('lingua-crash-log') ?? '[]') as Array<
      number | { timestamp: number; region: string }
    >;

    expect(log).toEqual([1_000, { timestamp: 2_000, region: 'notebook' }]);
    expect(recordCrash(3_000, 'TypeError:next:workspace.tsx:2:1', 'sql')).toBe('factory');
  });

  it('factory mode wins over query string and crash mark in resolveRecoveryState', () => {
    setQueryString('?safe-mode=1');
    recordCrash(1_000);
    recordCrash(2_000);
    recordCrash(3_000);
    expect(resolveRecoveryState()).toBe('factory');
  });
});

describe('safeBoot — applyFactoryReset preserves only the license', () => {
  beforeEach(() => {
    localStorage.clear();
    setQueryString('');
    localStorage.setItem(LICENSE_KEY, 'fake-license-token');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('lingua-snippets', JSON.stringify({ snippets: [] }));
    localStorage.setItem('lingua-recent-projects', '["/some/path"]');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('keeps lingua-license and clears every other key', () => {
    applyFactoryReset();
    expect(localStorage.getItem(LICENSE_KEY)).toBe('fake-license-token');
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(localStorage.getItem('lingua-snippets')).toBeNull();
    expect(localStorage.getItem('lingua-recent-projects')).toBeNull();
  });

  it('clearRecoveryMarks wipes the crash log + factory + safe marks', () => {
    markCrashOnNextBoot();
    recordCrash(1_000);
    recordCrash(2_000);
    recordCrash(3_000);
    expect(isFactoryMode()).toBe(true);
    clearRecoveryMarks();
    expect(isFactoryMode()).toBe(false);
    expect(isSafeMode()).toBe(false);
  });

  it('clearRecoveryMarksIfCurrentBootClean clears a stale mark from a previous boot', () => {
    localStorage.setItem('lingua-safe-mode', '1');
    expect(isSafeMode()).toBe(true);
    expect(clearRecoveryMarksIfCurrentBootClean()).toBe(true);
    expect(isSafeMode()).toBe(false);
  });

  it('clearRecoveryMarksIfCurrentBootClean preserves marks when this boot crashed', () => {
    markCrashOnNextBoot();
    expect(clearRecoveryMarksIfCurrentBootClean()).toBe(false);
    expect(isSafeMode()).toBe(true);
  });
});

describe('safeBoot — applyRecoveryStateAttr mirrors state on <html>', () => {
  afterEach(() => {
    delete document.documentElement.dataset.recoveryState;
  });

  it('writes data-recovery-state on the documentElement', () => {
    applyRecoveryStateAttr('safe');
    expect(document.documentElement.dataset.recoveryState).toBe('safe');
    applyRecoveryStateAttr('factory');
    expect(document.documentElement.dataset.recoveryState).toBe('factory');
    applyRecoveryStateAttr('normal');
    expect(document.documentElement.dataset.recoveryState).toBe('normal');
  });
});

describe('safeBoot — applyFactoryReset preserves the license even when clear() throws', () => {
  let originalClear: typeof Storage.prototype.clear;

  beforeEach(() => {
    localStorage.clear();
    setQueryString('');
    localStorage.setItem(LICENSE_KEY, 'fake-license-token');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('lingua-snippets', JSON.stringify({ snippets: [] }));
    originalClear = Storage.prototype.clear;
    // Force the clear() throw path so the per-key fallback runs.
    Storage.prototype.clear = function () {
      throw new Error('quota exceeded');
    };
  });

  afterEach(() => {
    Storage.prototype.clear = originalClear;
    localStorage.clear();
  });

  it('per-key fallback skips lingua-license so the license survives the reset', () => {
    applyFactoryReset();
    expect(localStorage.getItem(LICENSE_KEY)).toBe('fake-license-token');
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(localStorage.getItem('lingua-snippets')).toBeNull();
  });
});

describe('safeBoot — recordCrash dedupes by fingerprint within a 50ms window', () => {
  beforeEach(() => {
    localStorage.clear();
    setQueryString('');
    _resetCrashFingerprintsForTests();
  });

  afterEach(() => {
    localStorage.clear();
    _resetCrashFingerprintsForTests();
  });

  it('two recordCrash calls with the same fingerprint within 50ms count as one', () => {
    const fp = 'TypeError:boom:foo.tsx:1:1';
    recordCrash(1_000, fp);
    recordCrash(1_010, fp);
    const log = JSON.parse(localStorage.getItem('lingua-crash-log') ?? '[]') as number[];
    expect(log).toHaveLength(1);
  });

  it('two recordCrash calls with different fingerprints both count', () => {
    recordCrash(1_000, 'TypeError:a:foo.tsx:1:1');
    recordCrash(1_010, 'TypeError:b:bar.tsx:1:1');
    const log = JSON.parse(localStorage.getItem('lingua-crash-log') ?? '[]') as number[];
    expect(log).toHaveLength(2);
  });

  it('the same fingerprint outside the 50ms window counts again', () => {
    const fp = 'TypeError:boom:foo.tsx:1:1';
    recordCrash(1_000, fp);
    recordCrash(1_100, fp); // 100ms later, dedupe expired
    const log = JSON.parse(localStorage.getItem('lingua-crash-log') ?? '[]') as number[];
    expect(log).toHaveLength(2);
  });

  it('three deduped events keep the boot-loop counter from prematurely escalating to factory', () => {
    const fp = 'TypeError:repeat:foo.tsx:1:1';
    expect(recordCrash(1_000, fp)).toBe('normal');
    expect(recordCrash(1_010, fp)).toBe('normal');
    expect(recordCrash(1_020, fp)).toBe('normal');
    expect(isFactoryMode()).toBe(false);
  });
});

describe('safeBoot — buildCrashFingerprint', () => {
  it('uses error name, truncated message, and the first stack frame', () => {
    const error = new Error('something broke');
    error.stack = 'Error: something broke\n    at Foo (asset:1:1)\n    at Bar (asset:2:2)';
    const fp = buildCrashFingerprint(error);
    expect(fp).toContain('Error');
    expect(fp).toContain('something broke');
    expect(fp).toContain('Foo');
    expect(fp).not.toContain('Bar');
  });

  it('handles non-Error throws without crashing', () => {
    expect(buildCrashFingerprint('a string')).toMatch(/non-error:a string/u);
    expect(buildCrashFingerprint(null)).toMatch(/non-error/u);
  });
});
