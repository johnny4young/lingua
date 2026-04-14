import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';

describe('web adapter', () => {
  beforeAll(async () => {
    initI18n('en');
    await import('../../src/web/adapter');
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
      'La compilación de Go no está disponible en la versión web. Descarga la app de escritorio para compilar código Go.'
    );
    expect(rustResult.stderr).toBe(
      'La compilación de Rust no está disponible en la versión web. Descarga la app de escritorio para compilar código Rust.'
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

  it('cancels close flows by default in the browser build', async () => {
    await expect(window.lingua.confirmClose([], 'es')).resolves.toBe(2);
    await expect(window.lingua.confirmCloseTab('draft.ts', 'es')).resolves.toBe(2);
  });

  it('reports no installed plugins in the browser build', async () => {
    await expect(window.lingua.plugins.getInstallDirectory()).resolves.toBeNull();
    await expect(window.lingua.plugins.list()).resolves.toEqual([]);
  });
});
