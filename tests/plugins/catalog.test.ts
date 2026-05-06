import { describe, expect, it } from 'vitest';
import {
  getBundledPluginIds,
  hasBundledPlugin,
  loadBundledPlugin,
} from '../../src/renderer/plugins/catalog';

describe('bundled plugin catalog', () => {
  it('matches the bundled plugin id allowlist', () => {
    expect(getBundledPluginIds()).toEqual(['lua']);
    expect(hasBundledPlugin('lua')).toBe(true);
  });

  it('does not treat inherited object properties as bundled plugin ids', async () => {
    expect(hasBundledPlugin('constructor')).toBe(false);
    expect(hasBundledPlugin('toString')).toBe(false);
    await expect(loadBundledPlugin('constructor')).resolves.toBeUndefined();
    await expect(loadBundledPlugin('toString')).resolves.toBeUndefined();
  });
});
