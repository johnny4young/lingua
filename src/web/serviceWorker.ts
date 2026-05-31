/**
 * Web service-worker lifecycle, split out of `main.tsx` so it unit-tests
 * without a real browser.
 *
 * - Production: register the cache-first service worker (`public/sw.js`)
 *   for offline / PWA support.
 * - Dev: never register. `dev:web` and `dev:web:pro` share port 5174, so
 *   a single SW scope + cache pins the first session's transformed
 *   modules — including the inlined
 *   `import.meta.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` — and shadows
 *   every later session, stranding a freshly minted dev token on a stale
 *   public key. We also proactively unregister any SW a prior visit left
 *   behind. `public/sw.js` self-destructs on the dev origins too, so this
 *   is belt-and-suspenders for the tab whose cached `main.tsx` predates
 *   that change.
 */
export interface ServiceWorkerLifecycleDeps {
  /** `import.meta.env.PROD` — true only for built bundles, not dev servers. */
  isProduction: boolean;
  /** `import.meta.env.BASE_URL`; the SW lives at `${baseUrl}sw.js`. */
  baseUrl: string;
  /** `navigator.serviceWorker`, or undefined when the API is unavailable. */
  container: ServiceWorkerContainer | undefined;
  /** `window.caches`, or undefined when the Cache API is unavailable. */
  cacheStorage: CacheStorage | undefined;
  /** Non-throwing diagnostic sink; defaults to a no-op. */
  warn?: (message: string, error: unknown) => void;
}

export function shouldRegisterServiceWorkerForMode(mode: string): boolean {
  return mode !== 'development';
}

export async function manageServiceWorker(deps: ServiceWorkerLifecycleDeps): Promise<void> {
  const { isProduction, baseUrl, container } = deps;
  if (!container) return;

  if (isProduction) {
    try {
      await container.register(`${baseUrl}sw.js`);
    } catch (error) {
      deps.warn?.('Service Worker registration failed:', error);
    }
    return;
  }

  // Dev: ensure no service worker survives to shadow the dev server's
  // fresh modules. Tear down any registration + cache a prior production
  // visit or older dev build left behind.
  try {
    const registrations = await container.getRegistrations();
    if (registrations.length === 0) return;
    await Promise.all(registrations.map(registration => registration.unregister()));
    if (deps.cacheStorage) {
      const keys = await deps.cacheStorage.keys();
      await Promise.all(keys.map(key => deps.cacheStorage!.delete(key)));
    }
  } catch (error) {
    deps.warn?.('Service Worker dev teardown failed:', error);
  }
}
