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
