import { useEffect, useRef, useState } from 'react';
import { fetchLatestWebVersion } from '../services/webUpdateServer';

/**
 * RL-061 Slice 5 — web update banner polling driver.
 *
 * Polls `updates.linguacode.dev/web/version` every 12 hours so the
 * banner can compare against the build-time pin (`__LINGUA_APP_VERSION__`,
 * injected via `vite.web.config.mts:getSharedBuildDefines()` from
 * `package.json#version`).
 *
 * Cadence rationale: long-lived web tabs is the target — devs who
 * keep Lingua open through a workday. Indie scale + 12h × N tabs ≈
 * 2 polls per tab per day — a free CF Worker absorbs that without
 * counting toward any budget.
 *
 * `visibilitychange` retrigger: when the tab returns to the
 * foreground after being hidden for >1 hour, fire an immediate poll.
 * Catches users who left the tab idle past one full poll cycle and
 * want a quick check-in when they come back.
 *
 * No-ops in:
 *   - Desktop builds (`window.lingua.platform !== 'web'` means the
 *     native autoupdater handles updates already).
 *   - jsdom / SSR (`typeof window === 'undefined'`).
 */

export const WEB_VERSION_POLL_INTERVAL_MS = 12 * 60 * 60 * 1000;
const VISIBILITY_REPOLL_THRESHOLD_MS = 60 * 60 * 1000;

export interface WebVersionState {
  /** Latest version reported by the server, or null when no fetch has succeeded yet. */
  remoteVersion: string | null;
  /** Build-time pinned version baked into the bundle (__LINGUA_APP_VERSION__). */
  pinnedVersion: string;
}

declare const __LINGUA_APP_VERSION__: string | undefined;

function readPinnedVersion(): string {
  // The Vite define rewrites this identifier at build time. In jsdom
  // tests the constant is not declared — fall back to a sentinel so
  // unit tests work without a build step.
  try {
    if (typeof __LINGUA_APP_VERSION__ === 'string' && __LINGUA_APP_VERSION__.length > 0) {
      return __LINGUA_APP_VERSION__;
    }
  } catch {
    // ReferenceError when the define is missing — fall through.
  }
  return '0.0.0';
}

function shouldRunPolling(): boolean {
  if (typeof window === 'undefined') return false;
  // Browser builds also expose `window.lingua` through src/web/adapter.ts.
  // Only native Electron platforms should skip this hook because their
  // auto-updater (src/main/updater.ts) owns update UX.
  if (typeof window.lingua !== 'undefined' && window.lingua.platform !== 'web') return false;
  return true;
}

export function useWebVersionPolling(): WebVersionState {
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);
  const lastPollAtRef = useRef<number>(0);

  useEffect(() => {
    if (!shouldRunPolling()) return undefined;

    let cancelled = false;

    const poll = async () => {
      const result = await fetchLatestWebVersion();
      lastPollAtRef.current = Date.now();
      if (cancelled) return;
      if (result?.version) {
        setRemoteVersion(result.version);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastPollAtRef.current < VISIBILITY_REPOLL_THRESHOLD_MS) return;
      void poll();
    };

    void poll();
    const interval = window.setInterval(poll, WEB_VERSION_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return { remoteVersion, pinnedVersion: readPinnedVersion() };
}
