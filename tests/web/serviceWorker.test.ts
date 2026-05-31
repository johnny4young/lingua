import { describe, expect, it, vi } from 'vitest';
import {
  manageServiceWorker,
  shouldRegisterServiceWorkerForMode,
} from '../../src/web/serviceWorker';

/**
 * Unit tests for `manageServiceWorker` — the prod-only registration gate
 * that keeps a cache-first service worker from shadowing the dev server's
 * fresh modules on the shared :5174 scope (which strands `dev:web:pro` on
 * a stale license public key). All platform objects are injected so this
 * runs without a real browser.
 */

type ContainerMock = ServiceWorkerContainer & {
  register: ReturnType<typeof vi.fn>;
  getRegistrations: ReturnType<typeof vi.fn>;
  controller: ServiceWorker | null;
};

function makeContainer(overrides: Partial<Record<keyof ContainerMock, unknown>> = {}): ContainerMock {
  return {
    register: vi.fn(async () => ({})),
    getRegistrations: vi.fn(async () => []),
    controller: null,
    ...overrides,
  } as unknown as ContainerMock;
}

function makeCacheStorage(keys: string[] = []) {
  return {
    keys: vi.fn(async () => keys),
    delete: vi.fn(async () => true),
    open: vi.fn(),
    has: vi.fn(),
    match: vi.fn(),
  } as unknown as CacheStorage & { keys: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
}

describe('manageServiceWorker — production', () => {
  it('treats Vite build modes as registerable even when NODE_ENV is inherited as development', () => {
    expect(shouldRegisterServiceWorkerForMode('development')).toBe(false);
    expect(shouldRegisterServiceWorkerForMode('production')).toBe(true);
    expect(shouldRegisterServiceWorkerForMode('staging')).toBe(true);
  });

  it('registers the service worker at `${baseUrl}sw.js`', async () => {
    const container = makeContainer();
    await manageServiceWorker({
      isProduction: true,
      baseUrl: '/',
      container,
      cacheStorage: undefined,
    });
    expect(container.register).toHaveBeenCalledWith('/sw.js');
    expect(container.getRegistrations).not.toHaveBeenCalled();
  });

  it('honors a non-root base path (GitHub Pages / subpath deploys)', async () => {
    const container = makeContainer();
    await manageServiceWorker({
      isProduction: true,
      baseUrl: '/lingua/',
      container,
      cacheStorage: undefined,
    });
    expect(container.register).toHaveBeenCalledWith('/lingua/sw.js');
  });

  it('swallows a registration failure and routes it to warn instead of throwing', async () => {
    const error = new Error('registration boom');
    const container = makeContainer({ register: vi.fn(async () => { throw error; }) });
    const warn = vi.fn();
    await expect(
      manageServiceWorker({ isProduction: true, baseUrl: '/', container, cacheStorage: undefined, warn })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Service Worker registration failed:', error);
  });
});

describe('manageServiceWorker — dev', () => {
  it('never registers and is a no-op when there is no service worker to tear down', async () => {
    const container = makeContainer();
    const cacheStorage = makeCacheStorage([]);
    await manageServiceWorker({ isProduction: false, baseUrl: '/', container, cacheStorage });
    expect(container.register).not.toHaveBeenCalled();
    expect(container.getRegistrations).toHaveBeenCalledTimes(1);
    expect(cacheStorage.delete).not.toHaveBeenCalled();
  });

  it('unregisters a stale registration and clears every cache so the dev key is not shadowed', async () => {
    const unregister = vi.fn(async () => true);
    const container = makeContainer({
      getRegistrations: vi.fn(async () => [{ unregister } as unknown as ServiceWorkerRegistration]),
    });
    const cacheStorage = makeCacheStorage(['lingua-v5', 'lingua-v4']);
    await manageServiceWorker({ isProduction: false, baseUrl: '/', container, cacheStorage });
    expect(container.register).not.toHaveBeenCalled();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(cacheStorage.delete).toHaveBeenCalledWith('lingua-v5');
    expect(cacheStorage.delete).toHaveBeenCalledWith('lingua-v4');
  });

  it('swallows a teardown failure and routes it to warn instead of throwing', async () => {
    const container = makeContainer({ getRegistrations: vi.fn(async () => { throw new Error('teardown boom'); }) });
    const warn = vi.fn();
    await expect(
      manageServiceWorker({ isProduction: false, baseUrl: '/', container, cacheStorage: undefined, warn })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('manageServiceWorker — unsupported environments', () => {
  it('does nothing when the service worker API is unavailable', async () => {
    await expect(
      manageServiceWorker({ isProduction: true, baseUrl: '/', container: undefined, cacheStorage: undefined })
    ).resolves.toBeUndefined();
  });
});
