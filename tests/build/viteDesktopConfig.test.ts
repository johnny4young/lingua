import { describe, expect, it } from 'vitest';
import mainConfigExport from '../../vite.main.config.mts';
import preloadConfigExport from '../../vite.preload.config.mts';

type ConfigExport = typeof mainConfigExport | typeof preloadConfigExport;

async function resolveBuildOptions(configExport: ConfigExport, mode: string) {
  const config =
    typeof configExport === 'function'
      ? await configExport({
          command: 'build',
          mode,
          isSsrBuild: false,
          isPreview: false,
        })
      : configExport;

  return (config as { build?: { sourcemap?: unknown; minify?: unknown } }).build ?? {};
}

describe('desktop Vite build config', () => {
  it('keeps main and preload builds debuggable in development mode', async () => {
    await expect(resolveBuildOptions(mainConfigExport, 'development')).resolves.toMatchObject({
      sourcemap: true,
      minify: false,
    });
    await expect(resolveBuildOptions(preloadConfigExport, 'development')).resolves.toMatchObject({
      sourcemap: true,
      minify: false,
    });
  });

  it('does not ship source maps or unminified desktop process bundles in production', async () => {
    await expect(resolveBuildOptions(mainConfigExport, 'production')).resolves.toMatchObject({
      sourcemap: false,
      minify: 'esbuild',
    });
    await expect(resolveBuildOptions(preloadConfigExport, 'production')).resolves.toMatchObject({
      sourcemap: false,
      minify: 'esbuild',
    });
  });
});
