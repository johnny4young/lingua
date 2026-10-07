import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const downloadBase = 'https://github.com/johnny4young/lingua/releases/download/v0.0.0/';
const platforms = [
  {
    name: 'macOS',
    desktop: ['Lingua-0.0.0-mac-arm64.dmg', 'Lingua-0.0.0-mac-x64.dmg'],
    cli: ['lingua-cli-v0.0.0-darwin-arm64.zip', 'lingua-cli-v0.0.0-darwin-x64.zip'],
  },
  {
    name: 'Windows',
    desktop: ['Lingua-0.0.0-win-x64.exe'],
    cli: ['lingua-cli-v0.0.0-windows-x64.zip'],
  },
  {
    name: 'Linux',
    desktop: ['Lingua-0.0.0-linux-x86_64.AppImage'],
    cli: ['lingua-cli-v0.0.0-linux-x64.zip'],
  },
];
const locales = [
  {
    id: 'en',
    route: '/releases',
    desktop: 'Desktop app',
    cli: 'Terminal tool (CLI)',
    desktopHint: 'graphical editor and console',
    cliHint: 'without a graphical editor',
    verify: 'Verify your download',
  },
  {
    id: 'es',
    route: '/es/releases',
    desktop: 'Aplicación de escritorio',
    cli: 'Herramienta de terminal (CLI)',
    desktopHint: 'editor gráfico y la consola',
    cliHint: 'sin editor gráfico',
    verify: 'Verificar descarga',
  },
];

for (const locale of locales) {
  test(`${locale.id} download products and responsive layout`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('download', () => errors.push('Unexpected binary download'));
    // The test reads hrefs, never follows release links or external services.
    // An unexpected external dependency is both blocked and a test failure.
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== baseURL) {
        externalRequests.push(route.request().url());
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });

    const response = await page.goto(locale.route, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.id);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Lingua v0.0.0', exact: true })
    ).toBeVisible();
    await expect(page.locator('.platform-card')).toHaveCount(3);
    await expect(page.locator('.asset-link')).toHaveCount(8);
    await expect(page.locator('[data-download-product="other"]')).toHaveCount(0);

    for (const platform of platforms) {
      const card = page.locator('.platform-card').filter({
        has: page.getByRole('heading', { level: 3, name: platform.name, exact: true }),
      });
      await expect(card).toHaveCount(1);
      await expect(card.locator('.product-group')).toHaveCount(2);
      for (const product of ['desktop', 'cli'] as const) {
        const group = card.locator(`[data-download-product="${product}"]`);
        await expect(
          group.getByRole('heading', { level: 4, name: locale[product], exact: true })
        ).toBeVisible();
        await expect(group.locator('.product-description')).toContainText(locale[`${product}Hint`]);
        if (product === 'cli') {
          await expect(group.locator('.product-description')).toContainText('Node.js 24.x');
        }
        await expect(group.locator('.asset-name')).toHaveText(platform[product]);
        for (const filename of platform[product]) {
          const link = group.getByRole('link').filter({ hasText: filename });
          await expect(link).toHaveCount(1);
          await expect(link).toBeVisible();
          await expect(link).toHaveAttribute('href', `${downloadBase}${filename}`);
          await expect(link).toHaveAttribute('rel', 'external noopener');
          await expect(link.locator('.asset-arch')).toHaveText(
            filename.includes('arm64') ? 'Apple Silicon / arm64' : 'Intel / x64'
          );
        }
      }
    }

    await expect(page.getByRole('link', { name: 'SHA256SUMS.txt', exact: true })).toHaveAttribute(
      'href',
      `${downloadBase}SHA256SUMS.txt`
    );
    const verify = page.locator('.verify-details');
    await expect(verify.locator('summary')).toHaveText(locale.verify);
    await verify.locator('summary').click();
    await expect(verify).toHaveAttribute('open', '');
    await expect(verify.locator('pre')).toHaveText('shasum -a 256 -c SHA256SUMS.txt');
    await verify.locator('summary').click();
    await expect(verify).not.toHaveAttribute('open', '');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

    const layout = await page.evaluate(() => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        };
      };
      return {
        viewport: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        cards: Array.from(document.querySelectorAll('.platform-card'), rect),
        links: Array.from(document.querySelectorAll('.asset-link'), rect),
        groups: Array.from(document.querySelectorAll('.platform-card'), card =>
          Array.from(card.querySelectorAll('.product-group'), rect)
        ),
        elements: Array.from(
          document.querySelectorAll<HTMLElement>(
            '.platform-card, .product-group, .product-description, .asset-link, .asset-name, .asset-arch, .asset-size, .platform-card h3, .platform-card h4'
          ),
          element => ({
            label: element.textContent?.trim(),
            ...rect(element),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
          })
        ),
        rows: Array.from(document.querySelectorAll('.asset-link'), link => ({
          meta: rect(link.querySelector('.asset-meta')!),
          size: rect(link.querySelector('.asset-size')!),
        })),
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport);
    for (const element of layout.elements) {
      expect(element.width, element.label).toBeGreaterThan(0);
      expect(element.height, element.label).toBeGreaterThan(0);
      expect(element.left, element.label).toBeGreaterThanOrEqual(-1);
      expect(element.right, element.label).toBeLessThanOrEqual(layout.viewport + 1);
      expect(element.scrollWidth, element.label).toBeLessThanOrEqual(element.clientWidth + 1);
      expect(element.scrollHeight, element.label).toBeLessThanOrEqual(element.clientHeight + 1);
    }
    for (let index = 1; index < layout.cards.length; index += 1) {
      const previous = layout.cards[index - 1]!;
      const current = layout.cards[index]!;
      if (testInfo.project.name === 'desktop') {
        expect(Math.abs(previous.top - current.top)).toBeLessThanOrEqual(1);
        expect(previous.right).toBeLessThanOrEqual(current.left);
      } else {
        expect(Math.abs(previous.left - current.left)).toBeLessThanOrEqual(1);
        expect(previous.bottom).toBeLessThanOrEqual(current.top);
      }
    }
    for (const [desktop, cli] of layout.groups) {
      expect(desktop!.bottom).toBeLessThanOrEqual(cli!.top);
    }
    for (const { meta, size } of layout.rows) expect(meta.right).toBeLessThanOrEqual(size.left);
    for (let left = 0; left < layout.links.length; left += 1) {
      for (let right = left + 1; right < layout.links.length; right += 1) {
        const a = layout.links[left]!;
        const b = layout.links[right]!;
        const overlaps =
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlaps, `Download controls ${left} and ${right} overlap`).toBe(false);
      }
    }

    const artifacts = path.resolve('output/playwright/website-downloads');
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({
      path: path.join(artifacts, `${locale.id}-${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    expect(externalRequests, 'Unexpected external requests').toEqual([]);
    expect(errors, 'Console errors, uncaught exceptions, or downloads').toEqual([]);
  });
}
