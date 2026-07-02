/**
 * Consent-mirror IPC handler (RL-067 follow-up).
 *
 * The renderer owns consent (source of truth lives in zustand-persist
 * localStorage). Main needs consent **before** `createWindow()` so
 * `crashReporter.start` can attach to renderer processes early enough to
 * catch startup crashes. This file gives main its own on-disk mirror:
 *   - `writeConsentMirror` is invoked through `consent:set` from the
 *     renderer whenever the user flips the telemetry toggle.
 *   - `readConsentMirror` is called from `app.on('ready')` before
 *     `createWindow()` so the reporter can make an informed decision.
 *
 * The write is atomic (tmp + rename) so a crash mid-write never leaves a
 * corrupt file that could be misread as `granted`. Reads default to
 * `unset` on any parse / filesystem failure, biasing toward not sending.
 */

import { typedHandle } from './typedHandle';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ConsentValue = 'granted' | 'declined' | 'unset';

const CONSENT_VALUES: readonly ConsentValue[] = ['granted', 'declined', 'unset'];

export function resolveConsentMirrorPath(userDataDir: string): string {
  return path.join(userDataDir, 'telemetry-consent.json');
}

function isConsentValue(value: unknown): value is ConsentValue {
  return typeof value === 'string' && (CONSENT_VALUES as readonly string[]).includes(value);
}

export async function writeConsentMirror(
  mirrorPath: string,
  value: ConsentValue
): Promise<void> {
  if (!isConsentValue(value)) {
    throw new Error(`Refusing to write unknown consent value: ${String(value)}`);
  }
  const tmp = `${mirrorPath}.${process.pid}.tmp`;
  const payload = JSON.stringify({ telemetryConsent: value, writtenAt: Date.now() }) + '\n';
  await writeFile(tmp, payload, { encoding: 'utf-8', mode: 0o600 });
  // Mode in `writeFile` is honoured only when the file is created. Re-apply
  // it so an existing tmp left over from a crashed write inherits the
  // restrictive permissions. Skip on win32 — `chmod` there only toggles the
  // read-only bit and produces a no-op warning.
  if (process.platform !== 'win32') {
    await chmod(tmp, 0o600);
  }
  // `rename` is atomic within a single filesystem on POSIX. On Windows it's
  // atomic when overwriting an existing file; non-existing target is a
  // regular create which cannot race with a second reader because readers
  // fall back to `unset` on ENOENT.
  await rename(tmp, mirrorPath);
}

export async function readConsentMirror(mirrorPath: string): Promise<ConsentValue> {
  try {
    const raw = await readFile(mirrorPath, 'utf-8');
    const parsed = JSON.parse(raw) as { telemetryConsent?: unknown };
    if (isConsentValue(parsed.telemetryConsent)) {
      return parsed.telemetryConsent;
    }
    return 'unset';
  } catch {
    return 'unset';
  }
}

export function registerConsentHandlers(mirrorPath: string): void {
  typedHandle('consent:set', async (_event, value: unknown) => {
    if (!isConsentValue(value)) {
      return { ok: false as const, reason: 'invalid-value' };
    }
    try {
      await writeConsentMirror(mirrorPath, value);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        reason: 'write-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
