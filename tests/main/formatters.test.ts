/**
 * Registration smoke test for the main-process formatter handlers. The
 * subprocess interop (spawn → stdin → stdout/stderr) is covered end-to-end
 * in the renderer's formatter unit suite where the IPC bridge is mocked.
 * Here we only verify that the main module registers the expected IPC
 * channels and exposes a cache reset helper for lifecycle control.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipcHandlers = new Map<string, unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
}));

describe('main/formatters', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the gofmt and rustfmt IPC handlers', async () => {
    const { registerFormatterHandlers } = await import('../../src/main/formatters');
    registerFormatterHandlers();

    expect(ipcHandlers.get('format:gofmt')).toBeTypeOf('function');
    expect(ipcHandlers.get('format:rustfmt')).toBeTypeOf('function');
  });

  it('exposes a cache reset helper for test lifecycles', async () => {
    const { resetFormatterAvailabilityCache } = await import('../../src/main/formatters');
    expect(() => resetFormatterAvailabilityCache()).not.toThrow();
  });
});
