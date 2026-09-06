// @vitest-environment node
import { build, type UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import rendererConfig from '../../vite.renderer.config.mts';
import webConfig from '../../vite.web.config.mts';

const configs: Array<[string, UserConfig]> = [
  ['web', webConfig({ command: 'build', mode: 'production' })],
  ['renderer', rendererConfig],
];

describe.each(configs)('%s vendor chunking', (_surface, config) => {
  it('keeps the preload pin exempt from the vendor size threshold', () => {
    const output = config.build!.rollupOptions!.output!;
    if (Array.isArray(output)) throw new Error('Expected one output');
    const chunking = output.advancedChunks!;
    const preload = chunking.groups!.find(group => group.name === 'vite-preload')!;
    expect(preload.minSize).toBe(0);
    expect(preload.priority).toBeGreaterThan(50);
    expect(chunking.minSize).toBe(4096);
    expect(output.manualChunks).toBeUndefined();
  });

  it('emits the small Vite helper as a real independent chunk', async () => {
    const output = config.build!.rollupOptions!.output!;
    if (Array.isArray(output)) throw new Error('Expected one output');
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'lazy-chunk-probe',
          resolveId(id) {
            if (id === 'probe-entry' || id === 'probe-lazy') return `\0${id}`;
          },
          load(id) {
            if (id === '\0probe-entry') return 'globalThis.loadProbe = () => import("probe-lazy");';
            if (id === '\0probe-lazy') return 'export const value = 42;';
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        rolldownOptions: {
          input: 'probe-entry',
          output: { advancedChunks: output.advancedChunks },
        },
      },
    });
    if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one output');
    const chunks = result.output.filter(item => item.type === 'chunk');
    const helpers = chunks.filter(chunk =>
      Object.keys(chunk.modules).some(id => id.includes('preload-helper'))
    );
    expect(helpers).toHaveLength(1);
    const helper = helpers[0]!;
    expect(helper.fileName).toMatch(/\/vite-preload-[^/]+\.js$/);
    expect(Object.keys(helper.modules)).toHaveLength(1);
    const entry = chunks.find(chunk => chunk.isEntry)!;
    expect(entry.imports).toContain(helper.fileName);
  });
});
