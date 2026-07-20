/**
 * implementation detail — deny-by-default permission handlers.
 *
 * Asserts the allow/deny policy (only main-frame clipboard read/write
 * permissions granted), that both Electron handlers are installed and consult
 * that policy, that a denial is logged (implementation note), and a source drift guard that
 * `defaultSession` is the only session — so a future partitioned session can't
 * ship without its own deny-by-default handlers (implementation note).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Session } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_PERMISSIONS,
  installPermissionHandlers,
  isPermissionAllowed,
} from '../../src/main/permissionHandlers';

const DENIED = [
  'media',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'hid',
  'serial',
  'usb',
  'openExternal',
  'pointerLock',
  'fullscreen',
] as const;

// Both clipboard permissions are granted to the main app frame: the app writes
// (copy affordances) AND reads (capsule import, Utility Pipeline paste,
// clipboard-on-focus) via the web Clipboard API. `clipboard-read` was added
// after dogfooding confirmed real read sites would otherwise break with
// NotAllowedError.
const GRANTED = ['clipboard-read', 'clipboard-sanitized-write'] as const;

type ReqHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
type CheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;

/** Capture the handlers a real session would receive. */
function mockSession(): {
  session: Session;
  request: () => ReqHandler;
  check: () => CheckHandler;
} {
  let req: ReqHandler | undefined;
  let chk: CheckHandler | undefined;
  const session = {
    setPermissionRequestHandler: (handler: ReqHandler | null) => {
      req = handler ?? undefined;
    },
    setPermissionCheckHandler: (handler: CheckHandler | null) => {
      chk = handler ?? undefined;
    },
  } as unknown as Session;
  return {
    session,
    request: () => {
      if (!req) throw new Error('request handler not installed');
      return req;
    },
    check: () => {
      if (!chk) throw new Error('check handler not installed');
      return chk;
    },
  };
}

/** Invoke a request handler and resolve the granted boolean it passes to the callback. */
function runRequest(
  handler: ReqHandler,
  permission: string,
  details: { isMainFrame: boolean; requestingUrl: string } = {
    isMainFrame: true,
    requestingUrl: 'file://lingua/index.html',
  }
): boolean {
  let granted: boolean | undefined;
  (
    handler as unknown as (
      wc: unknown,
      p: string,
      cb: (g: boolean) => void,
      d: unknown
    ) => void
  )(undefined, permission, (g) => {
    granted = g;
  }, details);
  if (granted === undefined) throw new Error('callback not invoked');
  return granted;
}

/** Invoke a check handler and return its boolean verdict. */
function runCheck(
  handler: CheckHandler,
  permission: string,
  details: { isMainFrame: boolean; requestingUrl?: string } = {
    isMainFrame: true,
    requestingUrl: 'file://lingua/index.html',
  }
): boolean {
  return (
    handler as unknown as (wc: unknown, p: string, origin: string, d: unknown) => boolean
  )(undefined, permission, 'file://', details);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isPermissionAllowed', () => {
  it.each(GRANTED)('allows %s', (permission) => {
    expect(isPermissionAllowed(permission, { isMainFrame: true })).toBe(true);
  });

  it.each(DENIED)('denies %s', (permission) => {
    expect(isPermissionAllowed(permission, { isMainFrame: true })).toBe(false);
  });

  it.each(GRANTED)('denies %s from subframes', (permission) => {
    expect(isPermissionAllowed(permission, { isMainFrame: false })).toBe(false);
  });

  it('keeps the allow-list minimal (widening must be a deliberate change)', () => {
    expect([...ALLOWED_PERMISSIONS].sort()).toEqual([
      'clipboard-read',
      'clipboard-sanitized-write',
    ]);
  });
});

describe('installPermissionHandlers', () => {
  it('installs both the request and check handlers', () => {
    const m = mockSession();
    installPermissionHandlers(m.session);
    expect(m.request).not.toThrow();
    expect(m.check).not.toThrow();
  });

  it.each(GRANTED)('grants %s through both handlers', (permission) => {
    const m = mockSession();
    installPermissionHandlers(m.session);
    expect(runRequest(m.request(), permission)).toBe(true);
    expect(runCheck(m.check(), permission)).toBe(true);
  });

  it.each(GRANTED)('denies %s from subframes through both handlers', (permission) => {
    const m = mockSession();
    installPermissionHandlers(m.session);
    expect(
      runRequest(m.request(), permission, {
        isMainFrame: false,
        requestingUrl: 'about:srcdoc',
      })
    ).toBe(false);
    expect(
      runCheck(m.check(), permission, {
        isMainFrame: false,
      })
    ).toBe(false);
  });

  it.each(DENIED)('denies %s through both handlers', (permission) => {
    const m = mockSession();
    installPermissionHandlers(m.session);
    expect(runRequest(m.request(), permission)).toBe(false);
    expect(runCheck(m.check(), permission)).toBe(false);
  });

  it('logs a denied permission (name + phase only) and stays silent on grants (implementation note)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = mockSession();
    installPermissionHandlers(m.session);

    runRequest(m.request(), 'geolocation');
    expect(warn).toHaveBeenCalledWith('[permissions] denied "geolocation" (request)');

    warn.mockClear();
    runRequest(m.request(), 'clipboard-sanitized-write');
    expect(warn).not.toHaveBeenCalled();

    runCheck(m.check(), 'media');
    expect(warn).toHaveBeenCalledWith('[permissions] denied "media" (check)');
  });
});

describe('single-session coverage (implementation note drift guard)', () => {
  it('uses only session.defaultSession — a partitioned session would need its own handlers', () => {
    const mainDir = resolve(__dirname, '../../src/main');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        const src = readFileSync(full, 'utf-8');
        // `session.fromPartition(...)` / `new Session()` create additional
        // sessions that would bypass the deny-by-default handlers on
        // defaultSession. If one is added, install handlers on it too and
        // update this guard.
        if (/\bfromPartition\s*\(/.test(src) || /new\s+Session\s*\(/.test(src)) {
          offenders.push(entry);
        }
      }
    };
    expect(existsSync(mainDir)).toBe(true);
    walk(mainDir);
    expect(offenders).toEqual([]);
  });
});
