// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import rendererConfig from '../../vite.renderer.config.mts';
import webConfig from '../../vite.web.config.mts';
import { BOOT_SMALL_MODULES, bootSmallGroup } from '../../build/bootChunk.mts';

const root = path.resolve(__dirname, '../..');
const groups = (config: typeof rendererConfig) => {
  const output = config.build!.rollupOptions!.output!;
  if (Array.isArray(output)) throw new Error('Expected one output');
  const chunking = output.codeSplitting as Exclude<typeof output.codeSplitting, boolean | undefined>;
  return chunking.groups!;
};

describe('desktop boot chunk', () => {
  it('names files that still exist, once each', () => {
    expect(new Set(BOOT_SMALL_MODULES).size).toBe(BOOT_SMALL_MODULES.length);
    for (const file of BOOT_SMALL_MODULES) expect(existsSync(path.join(root, file)), file).toBe(true);
  });

  it('captures exactly the listed modules, with either separator', () => {
    const group = bootSmallGroup('/repo');
    expect(group.test('/repo/src/renderer/stores/uiStore.ts')).toBe(true);
    expect(bootSmallGroup('C:\\repo').test('C:\\repo\\src\\shared\\workflowMode.ts')).toBe(true);
    expect(group.test('/repo/src/renderer/stores/editorStore.ts')).toBe(false);
    expect(group.test('/repo/node_modules/zustand/esm/index.mjs')).toBe(false);
  });

  it('applies to the desktop renderer only, below the preload pin', () => {
    const boot = groups(rendererConfig).find(group => group.name === 'boot-small');
    expect(boot).toMatchObject({ priority: 40, minSize: 0 });
    const preload = groups(rendererConfig).find(group => group.name === 'vite-preload')!;
    expect(preload.priority).toBeGreaterThan(boot!.priority!);
    const web = webConfig({ command: 'build', mode: 'production' });
    expect(groups(web).some(group => group.name === 'boot-small')).toBe(false);
  });
});
