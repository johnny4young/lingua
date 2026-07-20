import type { Session } from 'electron';

/**
 * implementation detail — deny-by-default permission posture for the Electron shell.
 *
 * The renderer runs untrusted-ish code (user scripts, third-party deps), so the
 * browser permission surface (camera/mic, geolocation, notifications, device
 * access, etc.) is denied by default. Only main-frame requests for permissions
 * on {@link ALLOWED_PERMISSIONS} are granted; everything else — including any
 * permission Chromium adds in a future version — is refused without a prompt.
 *
 * The allow-list is intentionally tiny and explicit so adding a capability is a
 * deliberate, reviewed change rather than an accidental default.
 */

/**
 * The ONLY browser permissions Lingua grants to the main app frame. Deliberately
 * minimal — the app's legitimate need is reading and writing the clipboard:
 *
 * - `clipboard-sanitized-write` — copy affordances (QR, JWT, snippets, share
 *   links, capsule export, SQL results, "Copy JSON", …) call
 *   `navigator.clipboard.writeText` / `.write`, which Chromium gates behind this.
 * - `clipboard-read` — clipboard READ features call `navigator.clipboard.readText`:
 *   capsule import from the clipboard (`useCapsuleImport`), the Utility Pipeline
 *   paste action, the clipboard-on-focus paste detection (`useClipboardOnFocus`),
 *   and the shared `readClipboard` helper. Denying it breaks all of those with
 *   `NotAllowedError`.
 *
 * Anything not listed here (`media`, `geolocation`, `notifications`, `midi`,
 * `hid`, `serial`, `usb`, `openExternal`, `fullscreen`, `pointerLock`, …) is
 * denied — including any permission a future Chromium adds. Subframes are denied
 * too, even for clipboard permissions, so sandboxed user HTML / Browser Preview
 * code never inherits the app shell's clipboard grants.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set<string>([
  'clipboard-read',
  'clipboard-sanitized-write',
]);

interface PermissionDecisionDetails {
  isMainFrame: boolean;
}

/**
 * Whether a requested permission is on the explicit allow-list for the main app
 * frame. Pure — the single decision point shared by both Electron handlers, so
 * the allow/deny policy is exhaustively unit-testable without a real session.
 */
export function isPermissionAllowed(
  permission: string,
  details: PermissionDecisionDetails
): boolean {
  return details.isMainFrame && ALLOWED_PERMISSIONS.has(permission);
}

/**
 * implementation — surface a denied permission so an unexpected denial (a future
 * feature silently hitting the deny-by-default wall) is diagnosable. Logs the
 * permission name + phase only: no origin, no URL, no payload, no PII.
 */
function logDeniedPermission(permission: string, phase: 'request' | 'check'): void {
  console.warn(`[permissions] denied "${permission}" (${phase})`);
}

/**
 * Install deny-by-default permission handlers on a session. Call once at
 * `app.ready`, before any window loads, so the first renderer request is already
 * gated. Both handlers consult the same {@link isPermissionAllowed} policy:
 *
 * - `setPermissionRequestHandler` governs interactive requests (the async
 *   permission prompts the Permissions API / `navigator.*` trigger).
 * - `setPermissionCheckHandler` governs synchronous capability checks
 *   (`navigator.permissions.query`, pre-flight checks before a feature runs).
 *
 * Setting both keeps a denied capability reporting `denied` consistently rather
 * than `prompt`.
 */
export function installPermissionHandlers(targetSession: Session): void {
  targetSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const allowed = isPermissionAllowed(permission, details);
    if (!allowed) logDeniedPermission(permission, 'request');
    callback(allowed);
  });

  targetSession.setPermissionCheckHandler(
    (_webContents, permission, _requestingOrigin, details) => {
      const allowed = isPermissionAllowed(permission, details);
      if (!allowed) logDeniedPermission(permission, 'check');
      return allowed;
    }
  );
}
