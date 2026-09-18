import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserSystemLanguages,
  initI18n,
  translateAppCommon,
} from '../../src/renderer/i18n';
import pkg from '../../package.json';

/** The hooks src/web/main.tsx connects. */
async function connectAppHooks(): Promise<void> {
  const { configureWebAdapter } = await import('../../src/web/adapter');
  configureWebAdapter({
    translate: (key) => translateAppCommon(key),
    getSystemLanguages: () => getBrowserSystemLanguages(),
  });
}

describe('web adapter', () => {
  beforeAll(async () => {
    initI18n('en');
    await connectAppHooks();
  });

  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('exposes the web platform and a file-system namespace', () => {
    expect(window.lingua.platform).toBe('web');
    expect(typeof window.lingua.fs.read).toBe('function');
    expect(typeof window.lingua.fs.write).toBe('function');
  });

  it('returns localized Go and Rust availability errors in Spanish', async () => {
    await i18next.changeLanguage('es');

    const goResult = await window.lingua.go.detect();
    const rustResult = await window.lingua.rust.run('fn main() {}');

    expect(goResult.error).toBe(
      'La compilación de Go no está disponible en la versión web. Abre el archivo en Lingua Desktop para compilar código Go.'
    );
    expect(rustResult.stderr).toBe(
      'La compilación de Rust no está disponible en la versión web. Abre el archivo en Lingua Desktop para compilar código Rust.'
    );
    expect(rustResult.error).toBe(
      'La compilación de Rust no está disponible en la versión web.'
    );
  });

  it('returns a localized unavailable updates state in Spanish', async () => {
    await i18next.changeLanguage('es');

    const result = await window.lingua.updates.getState();

    expect(result.status).toBe('unavailable');
    expect(result.supported).toBe(false);
    expect(result.message).toBe(
      'Las actualizaciones automáticas no están disponibles en la versión web.'
    );
  });

  it('returns localized formatter availability errors in the active language', async () => {
    await expect(window.lingua.format.gofmt('package main\n')).resolves.toMatchObject({
      available: false,
      error: 'Formatting Go or Rust requires the desktop build.',
    });

    await i18next.changeLanguage('es');

    await expect(window.lingua.format.rustfmt('fn main() {}\n')).resolves.toMatchObject({
      available: false,
      error: 'Formatear Go o Rust requiere la versión de escritorio.',
    });
  });

  it('reports the browser languages through the connected hook', async () => {
    await expect(window.lingua.getSystemLanguages()).resolves.toEqual(
      getBrowserSystemLanguages()
    );
  });

  it('uses the hooks connected most recently', async () => {
    const { configureWebAdapter } = await import('../../src/web/adapter');
    configureWebAdapter({
      translate: (key) => `translated:${key}`,
      getSystemLanguages: () => ['es-CO', 'en'],
    });
    try {
      await expect(window.lingua.rust.detect()).resolves.toEqual({
        installed: false,
        error: 'translated:errors.rust.webUnavailable',
      });
      await expect(window.lingua.getSystemLanguages()).resolves.toEqual(['es-CO', 'en']);
    } finally {
      await connectAppHooks();
    }
  });

  it('returns bundled app metadata in the browser build', async () => {
    const info = await window.lingua.getAppInfo();

    expect(info.productName).toBe('Lingua');
    expect(info.version).toBe(pkg.version);
    expect(info.licenseType).toBe('Commercial');
    expect(info.repositoryUrl).toBe('https://github.com/johnny4young/lingua');
    expect(info.licenseUrl).toBe('https://github.com/johnny4young/lingua/blob/main/LICENSE');
  });

  it('only opens safe external URLs in the browser build', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await expect(window.lingua.openExternal(null as unknown as string)).resolves.toBe(false);
    await expect(
      window.lingua.openExternal({ href: 'https://github.com/johnny4young/lingua' } as unknown as string)
    ).resolves.toBe(false);
    await expect(window.lingua.openExternal('javascript:alert(1)')).resolves.toBe(false);
    await expect(window.lingua.openExternal(' https://github.com/johnny4young/lingua ')).resolves.toBe(
      true
    );

    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/johnny4young/lingua',
      '_blank',
      'noopener,noreferrer'
    );
    openSpy.mockRestore();
  });

  it('cancels close flows by default in the browser build', async () => {
    await expect(window.lingua.confirmClose([], 'es')).resolves.toBe(2);
    await expect(window.lingua.confirmCloseTab('draft.ts', 'es')).resolves.toBe(2);
  });

  it('reports no installed plugins in the browser build', async () => {
    await expect(window.lingua.plugins.getInstallDirectory()).resolves.toBeNull();
    await expect(window.lingua.plugins.list()).resolves.toEqual([]);
  });
});

describe('web adapter before the app connects it', () => {
  it('answers with copy keys and no system languages instead of throwing', async () => {
    vi.resetModules();
    await import('../../src/web/adapter');

    await expect(window.lingua.go.detect()).resolves.toEqual({
      installed: false,
      error: 'errors.go.webUnavailable',
    });
    await expect(window.lingua.updates.getState()).resolves.toMatchObject({
      status: 'unavailable',
      message: 'updates.message.webUnavailable',
    });
    await expect(window.lingua.getSystemLanguages()).resolves.toEqual([]);
  });
});
