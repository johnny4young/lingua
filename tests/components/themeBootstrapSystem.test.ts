import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const HTML_ENTRIES = ['../../index.html', '../../src/web/index.html'];

function bootstrapScript(relative: string): string {
  const html = readFileSync(resolve(__dirname, relative), 'utf8');
  const match = /<script id="lingua-theme-bootstrap">([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) throw new Error(`No theme bootstrap in ${relative}`);
  return match[1];
}

function runBootstrap(relative: string, prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({ matches: prefersDark }),
  });
  new Function(bootstrapScript(relative))();
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

describe.each(HTML_ENTRIES)('theme bootstrap in %s with the System preference', (entry) => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.palette;
  });

  it.each([
    [false, 'light'],
    [true, 'dark'],
  ])('follows the OS (prefers dark: %s) even when the stored editor theme is stale', (prefersDark, expected) => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({ state: { theme: 'system', editorTheme: prefersDark ? 'lingua-light' : 'lingua-dark' }, version: 3 })
    );
    expect(runBootstrap(entry, prefersDark)).toBe(expected);
  });
});

describe.each(HTML_ENTRIES)('theme bootstrap in %s with Ink and Paper', (entry) => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.palette;
  });

  const palette = () => document.documentElement.dataset.palette ?? null;
  const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

  it('paints a fresh install on Ink', () => {
    expect(runBootstrap(entry, true)).toBe('dark');
    expect(palette()).toBe('ink');
    expect(themeColor()).toBe('#05090a');
  });

  it('paints a stored Paper choice and keeps other stored themes off the palette', () => {
    localStorage.setItem('lingua-settings', JSON.stringify({ state: { editorTheme: 'lingua-paper' }, version: 3 }));
    expect(runBootstrap(entry, true)).toBe('light');
    expect(palette()).toBe('paper');

    localStorage.setItem('lingua-settings', JSON.stringify({ state: { editorTheme: 'lingua-dark' }, version: 3 }));
    delete document.documentElement.dataset.palette;
    expect(runBootstrap(entry, true)).toBe('dark');
    expect(palette()).toBeNull();
  });

  it('paints Ink when the stored settings cannot be parsed, as the store falls back to its initial state', () => {
    localStorage.setItem('lingua-settings', '{bad json');
    expect(runBootstrap(entry, true)).toBe('dark');
    expect(palette()).toBe('ink');
  });

  it('follows the OS within Ink and Paper under System', () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({ state: { theme: 'system', editorTheme: 'lingua-ink' }, version: 3 })
    );
    expect(runBootstrap(entry, false)).toBe('light');
    expect(palette()).toBe('paper');
  });
});
