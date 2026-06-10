/**
 * RL-137 / AUDIT-17 — surface a denylist refusal to the user.
 *
 * When a reopen / pick is refused because the path falls inside a protected
 * family (`src/main/ipc/permissions.ts`), the renderer asks main to classify
 * the path (read-only, no capability minted), shows an actionable, localized
 * status notice naming the family, and emits a privacy-safe `fs.blocked`
 * telemetry signal that carries ONLY the family token — never the path.
 *
 * Classification is best-effort: any failure (web build, IPC error) resolves
 * silently so a launch-time restore path never throws.
 */

import { trackEvent } from './telemetry';
import { useUIStore } from '../stores/uiStore';

/**
 * Per-family notice copy. Falls back to the generic `fs.error.blockedPath`
 * message if a new family token ever lacks a dedicated key, so an un-mapped
 * family still produces an actionable (if less specific) notice rather than a
 * missing-key render.
 */
const BLOCKED_FAMILY_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  system: 'fs.error.blockedPath.system',
  credentials: 'fs.error.blockedPath.credentials',
  'app-data': 'fs.error.blockedPath.appData',
  'browser-profile': 'fs.error.blockedPath.browserProfile',
  'lingua-data': 'fs.error.blockedPath.linguaData',
};

/**
 * Surface an already-classified blocked family. Native picker handlers return
 * only this family token instead of rejecting with a path-bearing error, so the
 * renderer can localize the denial and emit telemetry without seeing the path.
 */
export function notifyBlockedFamily(family: string | null | undefined): void {
  if (!family) return;
  useUIStore.getState().pushStatusNotice({
    tone: 'error',
    messageKey: BLOCKED_FAMILY_MESSAGE_KEYS[family] ?? 'fs.error.blockedPath',
  });
  void trackEvent('fs.blocked', { family });
}

/**
 * Classify `absolutePath` against the filesystem denylist and, when it is
 * blocked, push an actionable notice + emit `fs.blocked { family }`. No-op when
 * the path is allowed or classification is unavailable.
 */
export async function notifyBlockedPath(absolutePath: string): Promise<void> {
  let family: string | null;
  try {
    const result = await window.lingua.fs.classifyBlockedPath(absolutePath);
    family = result.family;
  } catch {
    return;
  }
  if (!family) return;

  notifyBlockedFamily(family);
}
