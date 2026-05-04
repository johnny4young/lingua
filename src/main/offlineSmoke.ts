import type { Session } from 'electron';

/**
 * RL-083 Slice 1 — main-process offline-mode filter for desktop smoke.
 *
 * When `LINGUA_DESKTOP_SMOKE_OFFLINE=1` is set, the smoke harness wants
 * Python to boot, run, and produce stdout WITHOUT any HTTP/HTTPS
 * request leaking to a remote host. The renderer's CSP already blocks
 * remote scripts after Slice 1, but a future regression that adds a
 * fetch outside the CSP allowlist (e.g. an analytics ping) would slip
 * through silently. The webRequest filter installed here cancels every
 * request whose host is not loopback, and records each blocked URL so
 * the smoke summary can assert nothing tried to reach the CDN.
 *
 * The filter is a no-op outside offline-smoke mode — production
 * sessions never see this code path.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const ALLOWED_PROTOCOLS = new Set([
  'file:',
  'devtools:',
  'chrome:',
  'chrome-extension:',
  'data:',
  'blob:',
  'lingua:',
  'lingua-asset:',
]);

const blockedUrls: string[] = [];
let installed = false;

export function isOfflineSmokeRequested(): boolean {
  return process.env.LINGUA_DESKTOP_SMOKE_OFFLINE === '1';
}

function isLoopbackOrAllowed(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // A request URL Electron cannot parse is unusual; allow it through
    // rather than break the smoke for a benign request.
    return true;
  }

  if (ALLOWED_PROTOCOLS.has(url.protocol)) {
    return true;
  }

  if (
    url.protocol === 'http:' ||
    url.protocol === 'https:' ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    // Loopback covers Vite's dev-mode HMR socket and any localhost
    // development server we route Electron at during smoke.
    return LOOPBACK_HOSTS.has(url.hostname);
  }

  return false;
}

export function installOfflineSmokeFilter(session: Session): void {
  if (installed) {
    return;
  }
  installed = true;

  session.webRequest.onBeforeRequest((details, callback) => {
    if (isLoopbackOrAllowed(details.url)) {
      callback({ cancel: false });
      return;
    }
    blockedUrls.push(details.url);
    callback({ cancel: true });
  });
}

export function getBlockedOfflineSmokeUrls(): readonly string[] {
  return [...blockedUrls];
}

/** Test-only — clear recorded URLs and the install flag between cases. */
export function __resetOfflineSmokeState(): void {
  blockedUrls.length = 0;
  installed = false;
}
