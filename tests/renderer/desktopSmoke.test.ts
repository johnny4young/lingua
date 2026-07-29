import { afterEach, describe, expect, it } from 'vitest';
import { setActiveEditor } from '../../src/renderer/runtime/editorAccess';
import {
  desktopSmokeEnabled,
  waitForDesktopSmokeEditorReady,
} from '../../src/renderer/utils/desktopSmoke';

describe('desktop smoke renderer bridge', () => {
  const originalLingua = window.lingua;

  afterEach(() => {
    window.lingua = originalLingua;
    setActiveEditor(null);
  });

  it('enables the smoke hook when the desktop bridge exists', () => {
    window.lingua = {
      desktopSmoke: {
        enabled: false,
      },
    } as typeof window.lingua;

    expect(desktopSmokeEnabled()).toBe(true);
  });

  it('stays disabled on web where no desktop smoke bridge exists', () => {
    window.lingua = undefined;

    expect(desktopSmokeEnabled()).toBe(false);
  });

  it('waits for a mounted Monaco model instead of a fixed delay', async () => {
    const editor = {
      getModel: () => ({
        uri: { toString: () => 'file:///smoke.js' },
        getValue: () => 'console.log("smoke");',
      }),
    };
    window.setTimeout(() => {
      setActiveEditor(editor as Parameters<typeof setActiveEditor>[0]);
    }, 5);

    await expect(
      waitForDesktopSmokeEditorReady({
        timeoutMs: 100,
        pollIntervalMs: 1,
        expectedContent: 'console.log("smoke");',
      })
    ).resolves.toBeUndefined();
  });

  it('ignores a stale editor from the tab that the smoke just replaced', async () => {
    const staleEditor = {
      getModel: () => ({
        getValue: () => 'console.log("old tab");',
      }),
    };
    const smokeEditor = {
      getModel: () => ({
        getValue: () => 'console.log("new smoke tab");',
      }),
    };
    setActiveEditor(staleEditor as Parameters<typeof setActiveEditor>[0]);
    window.setTimeout(() => {
      setActiveEditor(smokeEditor as Parameters<typeof setActiveEditor>[0]);
    }, 5);

    await expect(
      waitForDesktopSmokeEditorReady({
        timeoutMs: 100,
        pollIntervalMs: 1,
        expectedContent: 'console.log("new smoke tab");',
      })
    ).resolves.toBeUndefined();
  });

  it('accepts platform line-ending normalization in the mounted smoke model', async () => {
    setActiveEditor({
      getModel: () => ({
        getValue: () => 'const value = 1;\r\nconsole.log(value);\r\n',
      }),
    } as Parameters<typeof setActiveEditor>[0]);

    await expect(
      waitForDesktopSmokeEditorReady({
        timeoutMs: 100,
        pollIntervalMs: 1,
        expectedContent: 'const value = 1;\nconsole.log(value);\n',
      })
    ).resolves.toBeUndefined();
  });

  it('fails clearly when Monaco never becomes interactive', async () => {
    await expect(
      waitForDesktopSmokeEditorReady({ timeoutMs: 5, pollIntervalMs: 1 })
    ).rejects.toThrow('Desktop smoke editor did not become interactive within 5ms.');
  });
});
