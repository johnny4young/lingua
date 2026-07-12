/**
 * RL-140 (AUDIT-20) — document-head contract for the web entry.
 *
 * Locks the boot hints added in RL-140: the color-scheme meta, the
 * preconnect links to the two first-party hosts, the vendored
 * JetBrains Mono preloads + inline @font-face, and the theme
 * bootstrap ported from the desktop entry (fold B). The static-HTML
 * assertions read the served document text instead of the live DOM so
 * a regression in the entry HTML fails even if React later patches
 * the head at runtime.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

const repoRoot = process.cwd();
const htmlEntryPaths = [
  path.join(repoRoot, 'index.html'),
  path.join(repoRoot, 'src/web/index.html'),
] as const;

function readHtmlEntry(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function extractBootSkeletonStyle(html: string): string {
  const match = html.match(
    /<style id="lingua-boot-skeleton-styles">([\s\S]*?)<\/style>/u
  );
  if (!match?.[1]) throw new Error('Missing boot skeleton style block');
  return match[1].trim();
}

test.describe('Document head — RL-140 boot hints', () => {
  test('keeps desktop and web HTML entries aligned on critical boot hints', () => {
    const [desktopHtml, webHtml] = htmlEntryPaths.map(readHtmlEntry);
    for (const filePath of htmlEntryPaths) {
      const html = readHtmlEntry(filePath);
      expect(html, filePath).toContain('<meta name="color-scheme" content="dark light"');
      expect(html, filePath).toContain('https://licenses.linguacode.dev');
      expect(html, filePath).toContain('https://updates.linguacode.dev');
      expect(html, filePath).toContain('./fonts/jetbrains-mono-latin-400-normal.woff2');
      expect(html, filePath).toContain('./fonts/jetbrains-mono-latin-700-normal.woff2');
      expect(html, filePath).toContain('resolveEditorThemePolarity');
      expect(html, filePath).toContain('parsed?.state?.editorTheme');
      expect(html, filePath).toContain('#0c1017');
      expect(html, filePath).toContain('#f4efe7');
      expect(html, filePath).toContain('id="lingua-boot-skeleton"');
      expect(html, filePath).toContain('data-testid="boot-skeleton"');
      expect(html, filePath).toContain('aria-hidden="true" inert');
    }
    expect(extractBootSkeletonStyle(desktopHtml)).toBe(
      extractBootSkeletonStyle(webHtml)
    );
  });

  test('serves color-scheme, preconnects, and font preloads in the static head', async ({
    page,
  }) => {
    const response = await page.request.get('/');
    expect(response.ok()).toBe(true);
    const html = await response.text();

    expect(html).toMatch(/<meta name="color-scheme" content="dark light"/);

    const preconnects = html.match(/<link[^>]*rel="preconnect"[^>]*>/g) ?? [];
    expect(preconnects.some((tag) => tag.includes('https://licenses.linguacode.dev'))).toBe(true);
    expect(preconnects.some((tag) => tag.includes('https://updates.linguacode.dev'))).toBe(true);
    for (const tag of preconnects) {
      expect(tag).toContain('crossorigin');
    }

    const preloads = html.match(/<link[^>]*rel="preload"[^>]*as="font"[^>]*>/g) ?? [];
    expect(
      preloads.some((tag) => tag.includes('jetbrains-mono-latin-400-normal.woff2'))
    ).toBe(true);
    expect(
      preloads.some((tag) => tag.includes('jetbrains-mono-latin-700-normal.woff2'))
    ).toBe(true);
    for (const tag of preloads) {
      expect(tag).toContain('crossorigin');
    }

    expect(html).toContain('@font-face');
    // Theme bootstrap ported from the desktop entry — fold B.
    expect(html).toContain('lingua-settings');
    expect(html).toMatch(/#0c1017/);
  });

  test('defaults to dark pre-hydration and loads the vendored editor font', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const probe = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme ?? null,
      hasDarkClass: document.documentElement.classList.contains('dark'),
      colorScheme: document.documentElement.style.colorScheme,
      themeColor:
        document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    }));
    expect(probe).toEqual({
      theme: 'dark',
      hasDarkClass: true,
      colorScheme: 'dark',
      themeColor: '#0c1017',
    });

    // fonts.load() forces the @font-face fetch through the same URL the
    // browser would use — a broken relative ./fonts/ path fails here.
    const fontLoaded = await page.evaluate(async () => {
      const faces = await document.fonts.load("12px 'JetBrains Mono'", 'abc');
      return faces.length > 0 && document.fonts.check("12px 'JetBrains Mono'", 'abc');
    });
    expect(fontLoaded).toBe(true);
  });

  test('applies a persisted light editor theme before hydration (theme bootstrap)', async ({
    page,
  }) => {
    // Seed BOTH polarity fields the way the app itself persists them
    // (applyThemePreset / applyThemePack write theme + editorTheme
    // together): the inline bootstrap reads state.theme, while React's
    // useAppTheme derives the effective shell polarity from
    // editorTheme. Seeding only one of them creates a state the app
    // never writes, and React would re-apply the other polarity right
    // after hydration.
    await page.addInitScript(() => {
      if (!window.localStorage.getItem('lingua-settings')) {
        window.localStorage.setItem(
          'lingua-settings',
          JSON.stringify({
            state: { theme: 'light', editorTheme: 'lingua-light' },
            version: 1,
          })
        );
      }
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // The inline bootstrap runs during document parse — before React
    // mounts — so the class, inline color-scheme, and theme-color meta
    // must already match the persisted theme at DOMContentLoaded.
    const probe = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme ?? null,
      hasLightClass: document.documentElement.classList.contains('light'),
      colorScheme: document.documentElement.style.colorScheme,
      themeColor:
        document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    }));
    expect(probe).toEqual({
      theme: 'light',
      hasLightClass: true,
      colorScheme: 'light',
      themeColor: '#f4efe7',
    });
  });

  test('prefers editorTheme over stale theme before hydration', async ({ page }) => {
    // Appearance has historically been able to persist an inconsistent
    // pair (theme: light, editorTheme: lingua-dark). React resolves the
    // shell from editorTheme, so the inline bootstrap must do the same
    // or it paints light first and React flips dark after hydration.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: { theme: 'light', editorTheme: 'lingua-dark' },
          version: 1,
        })
      );
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const probe = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme ?? null,
      hasDarkClass: document.documentElement.classList.contains('dark'),
      colorScheme: document.documentElement.style.colorScheme,
      themeColor:
        document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    }));
    expect(probe).toEqual({
      theme: 'dark',
      hasDarkClass: true,
      colorScheme: 'dark',
      themeColor: '#0c1017',
    });
  });
});
