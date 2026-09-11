// Vitest global setup — runs before each test file

// Monaco's basic-language contributions trigger `document.queryCommandSupported`
// via the clipboard module. jsdom does not implement this — polyfill it so
// language-contribution imports resolve without throwing at module load.
if (typeof document !== 'undefined' && typeof document.queryCommandSupported !== 'function') {
  document.queryCommandSupported = () => false;
}

// Monaco's standalone theme service reads `window.matchMedia` while it
// initialises. jsdom implements no such method, so the constructor throws
// inside Monaco's own error handler, which rethrows on a timer: vitest 5
// reports that as an unhandled error and fails the whole run even though
// every test passed. Stub the shape the service reads.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// Provide a working localStorage mock for environments (jsdom) that
// don't fully implement the Web Storage API.
const storage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  },
  writable: true,
});

// Initialise i18next with both catalogs so legacy component tests can switch
// the singleton directly via `i18next.changeLanguage(...)`. Production still
// loads only the active renderer catalog; this eager test setup avoids making
// every existing locale assertion aware of the bundle boundary.
import { initI18n } from '../src/renderer/i18n';
await initI18n('es');
await initI18n('en');
