import { afterEach, describe, expect, it } from 'vitest';
import { appPlatform } from '../../src/renderer/utils/appPlatform';

const setLingua = (value: unknown) => {
  (window as unknown as { lingua?: unknown }).lingua = value;
};

describe('appPlatform', () => {
  afterEach(() => {
    delete (window as unknown as { lingua?: unknown }).lingua;
  });

  it.each(['darwin', 'win32', 'linux'])('reports desktop for the %s preload', (os) => {
    setLingua({ platform: os });
    expect(appPlatform()).toBe('desktop');
  });

  it('reports web for the web adapter', () => {
    setLingua({ platform: 'web' });
    expect(appPlatform()).toBe('web');
  });

  it('reports web when no bridge is installed', () => {
    expect(appPlatform()).toBe('web');
  });
});
