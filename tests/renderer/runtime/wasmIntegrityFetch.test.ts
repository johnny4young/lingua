// @vitest-environment node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchRuntimeAssetWithRetry } from '../../../src/renderer/runtime/duckdbClient';
import { sha256HexToIntegrity } from '../../../src/renderer/runtime/wasmIntegrity';

const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const integrity = sha256HexToIntegrity(createHash('sha256').update(wasm).digest('hex'));
const requests = new Map<string, number>();
const server = createServer((request, response) => {
  const path = request.url ?? '/';
  requests.set(path, (requests.get(path) ?? 0) + 1);
  const status = Number(path.slice(1));
  response.writeHead(status, { 'Content-Type': 'application/wasm' });
  response.end(status === 200 ? wasm : 'HTTP error body');
});
let origin: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('verified WASM fetch with real HTTP and SRI', () => {
  it('returns matching bytes with integrity enforced', async () => {
    const response = await fetchRuntimeAssetWithRetry(`${origin}/200`, 3, 1, vi.fn(), { integrity });
    expect(Buffer.from(await response.arrayBuffer())).toEqual(wasm);
    expect(requests.get('/200')).toBe(1);
  });

  it.each([403, 404, 503])('does not retry HTTP %i hidden by SRI rejection', async status => {
    const sleep = vi.fn();
    await expect(fetchRuntimeAssetWithRetry(`${origin}/${status}`, 3, 1, sleep, { integrity }))
      .rejects.toThrow();
    expect(requests.get(`/${status}`)).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a tampered successful response or fall back to unverified fetch', async () => {
    const before = requests.get('/200') ?? 0;
    const sleep = vi.fn();
    const wrongIntegrity = sha256HexToIntegrity('0'.repeat(64));
    await expect(fetchRuntimeAssetWithRetry(`${origin}/200`, 3, 1, sleep, { integrity: wrongIntegrity }))
      .rejects.toThrow();
    expect(requests.get('/200')).toBe(before + 1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
