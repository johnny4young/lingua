/**
 * Coverage for the build-time update feed URL resolver. The helper is the
 * only path through which `__LINGUA_UPDATE_URL__` reaches `autoUpdater`,
 * so it is the natural place to enforce HTTPS-only and reject malformed
 * configuration before a packaged build talks to the wrong origin.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    isReady: () => false,
    once: vi.fn(),
  },
  autoUpdater: {
    on: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));

const { resolveUpdateFeedUrl } = await import('../../src/main/updater');

describe('resolveUpdateFeedUrl', () => {
  it('builds the feed URL for an HTTPS base', () => {
    expect(
      resolveUpdateFeedUrl('https://updates.example.com', 'darwin', '1.2.3')
    ).toBe('https://updates.example.com/update/darwin/1.2.3');
  });

  it('strips trailing slashes from the base before joining', () => {
    expect(
      resolveUpdateFeedUrl('https://updates.example.com/', 'win32', '0.2.1')
    ).toBe('https://updates.example.com/update/win32/0.2.1');
  });

  it('encodes platform and version segments so unusual characters cannot break the URL', () => {
    expect(
      resolveUpdateFeedUrl('https://updates.example.com', 'darwin', '1.2.3-beta /1')
    ).toBe('https://updates.example.com/update/darwin/1.2.3-beta%20%2F1');
  });

  it('returns null when the base is empty or undefined', () => {
    expect(resolveUpdateFeedUrl('', 'darwin', '1.0.0')).toBeNull();
    expect(resolveUpdateFeedUrl(undefined, 'darwin', '1.0.0')).toBeNull();
  });

  it('returns null for non-HTTPS schemes so updates never travel over plaintext', () => {
    expect(resolveUpdateFeedUrl('http://updates.example.com', 'darwin', '1.0.0')).toBeNull();
    expect(resolveUpdateFeedUrl('file:///tmp/updates', 'darwin', '1.0.0')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(resolveUpdateFeedUrl('not a url', 'darwin', '1.0.0')).toBeNull();
  });
});
