// Vitest global setup — runs before each test file

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

// Initialise i18next with English resources so component tests that use
// useTranslation() find a valid instance without extra setup.
import { initI18n } from '../src/renderer/i18n';
initI18n('en');
