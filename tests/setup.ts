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

// jsdom's user agent carries AppleWebKit without a Chrome or Safari token, so
// Monaco treats the environment as a WebKit web view and installs its clipboard
// workaround: click and keydown listeners on the document body that build a
// ClipboardItem. jsdom implements none, so the first click after an editor
// mounts throws inside that listener and vitest 5 fails the run on the
// unhandled error. Mirror the shape user-event's clipboard stub already
// expects (types plus an async getType returning a Blob), and keep the
// property writable so tests can still remove it to exercise fallbacks.
// Like a real ClipboardItem, the stub also observes the promises it is given:
// the workaround cancels the previous click's pending write on every click,
// and an unobserved cancellation fails the run as an unhandled rejection
// (tests/clipboardItemStub.test.tsx).
if (typeof window !== 'undefined' && typeof globalThis.ClipboardItem !== 'function') {
  class ClipboardItemStub {
    readonly presentationStyle = 'unspecified';

    constructor(private readonly data: Record<string, string | Blob | PromiseLike<string | Blob>>) {
      for (const value of Object.values(data)) {
        if (typeof value === 'object' && value !== null && 'then' in value) {
          // getType still awaits the original, so a reader sees the rejection.
          Promise.resolve(value).catch(() => {});
        }
      }
    }

    get types(): string[] {
      return Object.keys(this.data);
    }

    async getType(type: string): Promise<Blob> {
      const value = await this.data[type];
      if (value === undefined) {
        throw new Error(`${type} is not one of the available MIME types on this item.`);
      }
      return value instanceof Blob ? value : new Blob([value], { type });
    }

    static supports(): boolean {
      return true;
    }
  }
  Object.defineProperty(globalThis, 'ClipboardItem', {
    value: ClipboardItemStub,
    writable: true,
    configurable: true,
  });
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
