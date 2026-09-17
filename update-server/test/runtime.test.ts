import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';

// A dry-run bundle and mocked handler tests do not ask workerd to validate the
// entrypoint exports. Exercise the actual runtime before toolchain bumps ship.
let worker: Unstable_DevWorker | undefined;
beforeAll(async () => {
  worker = await unstable_dev('src/index.ts', {
    config: 'wrangler.toml',
    local: true,
    ip: '127.0.0.1',
    port: 0,
    inspectorPort: 0,
    persist: false,
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
  });
}, 30_000);
afterAll(async () => { await worker?.stop(); });

describe('update Worker runtime', () => {
  it('starts the deployed entrypoint and serves liveness without upstream requests', async () => {
    const response = await worker!.fetch('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, server: 'lingua-update-server', version: '0.1.0' });
  });

  it('preserves unknown-route errors', async () => {
    const response = await worker!.fetch('/nonexistent-runtime-smoke');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
  });
});
