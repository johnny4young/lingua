import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HTML_ENTRIES = ['../../index.html', '../../src/web/index.html'];

function runBootstrap(relative: string): void {
  const html = readFileSync(resolve(__dirname, relative), 'utf8');
  const match = /<script id="lingua-theme-bootstrap">([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) throw new Error(`No theme bootstrap in ${relative}`);
  new Function(match[1])();
}

function blockStorage(): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    },
  });
}

describe.each(HTML_ENTRIES)('theme bootstrap storage fallback in %s', (entry) => {
  let original: PropertyDescriptor;

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  });

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', original);
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('leaves working storage in place', () => {
    const before = window.localStorage;
    before.setItem('kept', '1');
    runBootstrap(entry);
    expect(window.localStorage).toBe(before);
    expect(window.localStorage.getItem('kept')).toBe('1');
  });

  it('installs an in-memory Storage when reading localStorage throws', () => {
    blockStorage();
    runBootstrap(entry);

    const storage = window.localStorage;
    expect(storage.getItem('missing')).toBeNull();
    storage.setItem('first', 'a');
    storage.setItem('second', 2 as unknown as string);
    expect(storage.getItem('second')).toBe('2');
    expect(storage.length).toBe(2);
    expect(storage.key(0)).toBe('first');
    expect(storage.key(5)).toBeNull();
    storage.removeItem('first');
    expect(storage.getItem('first')).toBeNull();
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it('falls back when localStorage is missing or getItem throws', () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: null });
    runBootstrap(entry);
    expect(window.localStorage.getItem('missing')).toBeNull();

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem() {
          throw new DOMException('Denied', 'SecurityError');
        },
      },
    });
    runBootstrap(entry);
    window.localStorage.setItem('works', '1');
    expect(window.localStorage.getItem('works')).toBe('1');
  });

  it('still applies a theme when storage is blocked', () => {
    blockStorage();
    runBootstrap(entry);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
