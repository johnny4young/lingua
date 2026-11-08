// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readProcessFootprints } from '../../src/main/processFootprint';

describe('readProcessFootprints', () => {
  it.runIf(process.platform === 'darwin')('reads the footprint macOS reports for a live process', async () => {
    const footprints = await readProcessFootprints([process.pid]);
    // A Node test worker holds at least a few MB of dirty memory.
    expect(footprints?.get(process.pid)).toBeGreaterThan(4 * 1024 * 1024);
  });

  it.runIf(process.platform !== 'darwin')('has no footprint to read outside macOS', async () => {
    await expect(readProcessFootprints([process.pid])).resolves.toBeNull();
  });

  it('measures nothing for no processes', async () => {
    await expect(readProcessFootprints([])).resolves.toBeNull();
  });
});
