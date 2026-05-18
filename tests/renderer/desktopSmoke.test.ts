import { afterEach, describe, expect, it } from 'vitest';
import { desktopSmokeEnabled } from '../../src/renderer/utils/desktopSmoke';

describe('desktop smoke renderer bridge', () => {
  const originalLingua = window.lingua;

  afterEach(() => {
    window.lingua = originalLingua;
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
});
