/**
 * RL-067 consent mirror — writer + reader round-trip, plus the failure
 * branches that must default to `unset` (missing file, malformed JSON,
 * unknown value under the key) so the crash reporter never upgrades a
 * corrupt read into `granted`.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
}));

describe('consent mirror', () => {
  let tempDir: string;

  beforeEach(() => {
    ipcHandlers.clear();
    vi.resetModules();
    tempDir = mkdtempSync(path.join(tmpdir(), 'lingua-consent-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a granted value through writeConsentMirror and readConsentMirror', async () => {
    const { writeConsentMirror, readConsentMirror } = await import(
      '../../src/main/ipc/consent'
    );
    const file = path.join(tempDir, 'consent.json');
    await writeConsentMirror(file, 'granted');
    expect(await readConsentMirror(file)).toBe('granted');
  });

  it('reads unset for a missing mirror file', async () => {
    const { readConsentMirror } = await import('../../src/main/ipc/consent');
    expect(await readConsentMirror(path.join(tempDir, 'nope.json'))).toBe('unset');
  });

  it('reads unset for malformed JSON so parse errors never grant consent', async () => {
    const { readConsentMirror } = await import('../../src/main/ipc/consent');
    const file = path.join(tempDir, 'bad.json');
    writeFileSync(file, '{not json');
    expect(await readConsentMirror(file)).toBe('unset');
  });

  it('reads unset when the key carries an unknown value', async () => {
    const { readConsentMirror } = await import('../../src/main/ipc/consent');
    const file = path.join(tempDir, 'weird.json');
    writeFileSync(file, JSON.stringify({ telemetryConsent: 'maybe' }));
    expect(await readConsentMirror(file)).toBe('unset');
  });

  it('writeConsentMirror refuses unknown values so callers cannot persist garbage', async () => {
    const { writeConsentMirror } = await import('../../src/main/ipc/consent');
    await expect(
      // @ts-expect-error — intentionally passing an invalid value
      writeConsentMirror(path.join(tempDir, 'x.json'), 'rejected')
    ).rejects.toThrow(/unknown consent value/u);
  });

  it('writeConsentMirror uses an atomic rename so readers never see a partial file', async () => {
    const { writeConsentMirror } = await import('../../src/main/ipc/consent');
    const file = path.join(tempDir, 'atomic.json');
    await writeConsentMirror(file, 'declined');
    const raw = await readFile(file, 'utf-8');
    const parsed = JSON.parse(raw) as { telemetryConsent?: unknown };
    expect(parsed.telemetryConsent).toBe('declined');
  });

  it.skipIf(process.platform === 'win32')(
    'writeConsentMirror produces a file owner-only readable on POSIX',
    async () => {
      const { stat } = await import('node:fs/promises');
      const { writeConsentMirror } = await import('../../src/main/ipc/consent');
      const file = path.join(tempDir, 'mode.json');
      await writeConsentMirror(file, 'granted');
      const info = await stat(file);
      // Permission bits live in the lower 9 bits of mode; expect 0o600.
      expect(info.mode & 0o777).toBe(0o600);
    }
  );

  it('registerConsentHandlers exposes consent:set and validates inputs', async () => {
    const { registerConsentHandlers, readConsentMirror } = await import(
      '../../src/main/ipc/consent'
    );
    const file = path.join(tempDir, 'ipc.json');
    registerConsentHandlers(file);

    const handler = ipcHandlers.get('consent:set');
    expect(handler).toBeTypeOf('function');

    const badValue = (await handler!({}, 'bogus')) as { ok: boolean; reason?: string };
    expect(badValue).toEqual({ ok: false, reason: 'invalid-value' });

    const happy = (await handler!({}, 'granted')) as { ok: boolean };
    expect(happy).toEqual({ ok: true });
    expect(await readConsentMirror(file)).toBe('granted');
  });
});
