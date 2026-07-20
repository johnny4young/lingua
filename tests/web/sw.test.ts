/**
 * Pin tests for `public/sw.js`. We don't spin up a full ServiceWorker
 * context (it requires `self.registration`, `caches`, etc.) — instead
 * we read the source as text and assert the structural invariants
 * the renderer relies on for cross-origin API safety.
 *
 * The full end-to-end behaviour (API-origin requests are NOT in
 * `caches.keys()`) is covered by the browser smoke described in
 * AGENTS.md. These tests just keep a refactor from silently removing
 * the bypass and reintroducing the cache-poisoning bug from
 * internal
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const SW_PATH = path.resolve(__dirname, '../../public/sw.js');

let cachedSource: string | null = null;
async function readSwSource(): Promise<string> {
  if (cachedSource !== null) return cachedSource;
  cachedSource = await readFile(SW_PATH, 'utf-8');
  return cachedSource;
}

describe('public/sw.js — API origin cache bypass', () => {
  it('lists licenses.linguacode.dev in the passthrough allow-list so /licenses/* never enters the cache', async () => {
    const source = await readSwSource();
    expect(source).toMatch(/const\s+PASSTHROUGH_ORIGINS\s*=/);
    expect(source).toContain("'https://licenses.linguacode.dev'");
  });

  it('lists updates.linguacode.dev in the passthrough allow-list so /web/version is never cached by the app shell', async () => {
    const source = await readSwSource();
    expect(source).toMatch(/const\s+PASSTHROUGH_ORIGINS\s*=/);
    expect(source).toContain("'https://updates.linguacode.dev'");
  });

  it('bumps CACHE_VERSION past v1 so existing clients drop any pre-fix license-status entries on first activate', async () => {
    const source = await readSwSource();
    const match = source.match(/const\s+CACHE_VERSION\s*=\s*'(v\d+)'/);
    expect(match).not.toBeNull();
    if (match) {
      const version = parseInt(match[1]!.slice(1), 10);
      expect(version).toBeGreaterThanOrEqual(2);
    }
  });

  it('short-circuits the fetch handler for license origins WITHOUT calling event.respondWith — letting the browser default fetch run untouched', async () => {
    const source = await readSwSource();
    // The fragile-but-pinned contract: there must be a branch that
    // checks `PASSTHROUGH_ORIGINS.includes(url.origin)` BEFORE any
    // respondWith / cache lookup the rest of the handler does. The
    // bypass uses an early `return;` (no respondWith) so cache.put
    // can't run on the response.
    expect(source).toMatch(/PASSTHROUGH_ORIGINS\.includes\(url\.origin\)/);
    // Sanity: the early return exists and is structured as expected.
    // Match across the bare `return;` line that follows the includes()
    // check so the test fails if a refactor flips it to respondWith.
    const bypassRegex = /if\s*\(\s*PASSTHROUGH_ORIGINS\.includes\(url\.origin\)\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}/;
    expect(source).toMatch(bypassRegex);
  });

  it('does not special-case or cache cross-origin Pyodide CDN URLs', async () => {
    const source = await readSwSource();
    expect(source).not.toContain('PYODIDE_CACHE_PREFIX');
    expect(source).not.toContain('cdn.jsdelivr.net/pyodide');
    expect(source).not.toContain('NETWORK_FIRST_ORIGINS');
  });
});

/**
 * Behavioral tests for the dev-server self-destruct. `dev:web` /
 * `dev:web:pro` share the :5174 SW scope, where the cache-first strategy
 * would pin the first session's modules (including the inlined license
 * public key) and shadow every later session. The SW must therefore be
 * inert + self-destruct on the localhost dev origins, while leaving
 * production and `preview:web` (port 4173, hashed assets) untouched.
 *
 * We execute the real `public/sw.js` in a vm with a faked ServiceWorker
 * global so a logic regression in the self-destruct path fails here.
 */
interface SwHarness {
  handlers: Record<string, (event: unknown) => void>;
  cacheNames: () => string[];
  unregistered: () => boolean;
  navigated: () => string[];
}

function instantiateSw(
  source: string,
  location: { hostname: string; port: string },
  seedCaches: string[] = []
): SwHarness {
  const cacheStore = new Map<string, Map<string, unknown>>();
  for (const name of seedCaches) cacheStore.set(name, new Map());
  let unregistered = false;
  const navigated: string[] = [];
  const origin = `http://${location.hostname}${location.port ? `:${location.port}` : ''}`;

  const fakeCaches = {
    async open(name: string) {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map());
      const bucket = cacheStore.get(name)!;
      return {
        async addAll(urls: string[]) {
          for (const url of urls) bucket.set(url, { ok: true });
        },
        async put(request: unknown, response: unknown) {
          const key = typeof request === 'string' ? request : (request as { url: string }).url;
          bucket.set(key, response);
        },
        async match(request: unknown) {
          const key = typeof request === 'string' ? request : (request as { url: string }).url;
          return bucket.get(key);
        },
      };
    },
    async keys() {
      return [...cacheStore.keys()];
    },
    async delete(name: string) {
      return cacheStore.delete(name);
    },
    async match() {
      return undefined;
    },
  };

  const handlers: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { hostname: location.hostname, port: location.port, href: `${origin}/sw.js` },
    registration: {
      scope: `${origin}/`,
      async unregister() {
        unregistered = true;
        return true;
      },
    },
    clients: {
      async matchAll() {
        return [
          {
            url: `${origin}/`,
            async navigate(url: string) {
              navigated.push(url);
              return null;
            },
          },
        ];
      },
      async claim() {},
    },
    skipWaiting() {},
    addEventListener(type: string, handler: (event: unknown) => void) {
      handlers[type] = handler;
    },
  };

  const sandbox: Record<string, unknown> = {
    self,
    caches: fakeCaches,
    URL,
    Response: class {
      constructor(
        public body?: unknown,
        init?: Record<string, unknown>
      ) {
        Object.assign(this, init);
      }
    },
    fetch: async () => ({ ok: true, clone() { return this; } }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  return {
    handlers,
    cacheNames: () => [...cacheStore.keys()],
    unregistered: () => unregistered,
    navigated: () => navigated,
  };
}

async function runActivate(sw: SwHarness): Promise<void> {
  const waited: Promise<unknown>[] = [];
  sw.handlers.activate?.({ waitUntil: (promise: Promise<unknown>) => waited.push(promise) });
  await Promise.all(waited);
}

function fetchRespondsWith(sw: SwHarness, request: { method: string; url: string; mode?: string }): boolean {
  let respondWithCalled = false;
  sw.handlers.fetch?.({ request, respondWith: () => { respondWithCalled = true; } });
  return respondWithCalled;
}

describe('public/sw.js — dev-server self-destruct', () => {
  it('on localhost:5174, activate clears every cache, unregisters, and reloads open tabs', async () => {
    const source = await readSwSource();
    const sw = instantiateSw(source, { hostname: 'localhost', port: '5174' }, ['lingua-v5', 'lingua-v4']);
    await runActivate(sw);
    expect(sw.cacheNames()).toEqual([]);
    expect(sw.unregistered()).toBe(true);
    expect(sw.navigated()).toEqual(['http://localhost:5174/']);
  });

  it('on a dev origin, fetch never calls respondWith — no cache can shadow a fresh module', async () => {
    const source = await readSwSource();
    const sw = instantiateSw(source, { hostname: '127.0.0.1', port: '5173' });
    const responded = fetchRespondsWith(sw, {
      method: 'GET',
      url: 'http://127.0.0.1:5173/src/renderer/stores/licenseStore.ts',
    });
    expect(responded).toBe(false);
  });

  it('on the production origin, activate keeps the SW registered and prunes only stale caches', async () => {
    const source = await readSwSource();
    const sw = instantiateSw(source, { hostname: 'app.linguacode.dev', port: '' }, ['lingua-v4', 'lingua-v5']);
    await runActivate(sw);
    expect(sw.unregistered()).toBe(false);
    expect(sw.cacheNames()).toEqual(['lingua-v5']);
  });

  it('on the production origin, fetch serves same-origin assets via respondWith', async () => {
    const source = await readSwSource();
    const sw = instantiateSw(source, { hostname: 'app.linguacode.dev', port: '' });
    const responded = fetchRespondsWith(sw, {
      method: 'GET',
      url: 'https://app.linguacode.dev/assets/index-abc123.js',
      mode: 'cors',
    });
    expect(responded).toBe(true);
  });

  it('on localhost:4173 (preview, hashed build assets), the SW is NOT treated as a dev server', async () => {
    const source = await readSwSource();
    const sw = instantiateSw(source, { hostname: 'localhost', port: '4173' }, ['lingua-v5']);
    await runActivate(sw);
    expect(sw.unregistered()).toBe(false);
    expect(sw.cacheNames()).toEqual(['lingua-v5']);
  });
});
