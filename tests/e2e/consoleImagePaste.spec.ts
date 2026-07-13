/**
 * RL-044 next slice — paste an image into the console renders it as a
 * rich `image` entry. Exercises the real ConsolePanel document-level
 * paste listener with a synthetic `ClipboardEvent` carrying an image
 * `File` (chromium supports `DataTransfer.items.add`).
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

// Ensure `<ConsolePanel>` (and its paste listener, mounted in an
// effect) is live before we dispatch. The seeded session leaves the
// bottom panel collapsed, so expand it via the restore bar, then make
// the Console tab the active panel.
async function waitForConsole(page: import('@playwright/test').Page) {
  const panel = page.locator('#guided-tour-console').first();
  if (!(await panel.isVisible().catch(() => false))) {
    const restore = page.getByTestId('bottom-panel-restore');
    if (await restore.isVisible().catch(() => false)) {
      await restore.click();
    }
  }
  const tab = page.getByTestId('bottom-panel-console-tab');
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  }
  await panel.waitFor({ timeout: 10000 });
}

// 1×1 transparent PNG.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function pasteImage(page: import('@playwright/test').Page, dataUri: string) {
  await page.evaluate((uri) => {
    // Build the File from the base64 directly — the app CSP blocks
    // `fetch(data:...)`, so decode in-page with atob instead.
    const base64 = uri.slice(uri.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'paste.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  }, dataUri);
}

async function pasteImageAndExpectRendered(
  page: import('@playwright/test').Page,
  dataUri: string
) {
  const img = page.locator('[data-testid="console-rich-image-wrapper"] img');

  await expect
    .poll(
      async () => {
        await pasteImage(page, dataUri);
        return img.count();
      },
      {
        message: 'console image paste should render an inline image',
        timeout: 10000,
        intervals: [100, 250, 500, 1000],
      }
    )
    .toBeGreaterThan(0);

  await expect(img.first()).toBeVisible();
  return img.first();
}

// Build + paste a >2 MiB PNG so the paste trips the cap and must be
// downscaled. Random-noise pixels keep PNG incompressible → large file;
// opaque (alpha 255) so the resize re-encodes to JPEG (fold C).
async function pasteOversizedImage(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 2000;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.floor(Math.random() * 256);
      image.data[i + 1] = Math.floor(Math.random() * 256);
      image.data[i + 2] = Math.floor(Math.random() * 256);
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (!blob) throw new Error('toBlob failed');
    const file = new File([blob], 'big.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

test.describe('Console image clipboard paste (RL-044)', () => {
  test('pasting an image renders it inline in the console (EN)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await waitForConsole(page);

    const img = await pasteImageAndExpectRendered(page, TINY_PNG);
    await expect(img).toHaveAttribute('src', /^data:image\//);

    // Ignore the expected cross-origin license-status fetch noise that
    // the local preview produces against the prod license API.
    const real = consoleErrors.filter(
      (e) => !/licenses\.linguacode\.dev|ERR_FAILED|Access to fetch/.test(e)
    );
    expect(real, real.join('\n')).toHaveLength(0);
  });

  test('pasting an image works under the Spanish locale (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await waitForConsole(page);
    await pasteImageAndExpectRendered(page, TINY_PNG);
  });

  test('an oversized image is resized to fit and renders as a JPEG (fold B)', async ({
    page,
  }) => {
    // Real-canvas resize path (jsdom can't run it): a >2 MiB PNG must be
    // downscaled + re-encoded to JPEG before rendering inline.
    test.setTimeout(60000);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await waitForConsole(page);

    // The seeded welcome scratchpad auto-runs after mount and clears the
    // console when that run starts. Wait for its first committed row before
    // dispatching the expensive synthetic paste so the harness cannot erase
    // the image between the visibility and MIME assertions under load.
    await expect(page.getByTestId('console-entry-row').first()).toBeVisible({
      timeout: 30000,
    });

    await pasteOversizedImage(page);

    const img = page.locator('[data-testid="console-rich-image-wrapper"] img');
    await expect(img.first()).toBeVisible({ timeout: 30000 });
    // Opaque source → resize re-encodes to JPEG (fold C); a non-resized
    // paste would keep the source PNG mime.
    await expect(img.first()).toHaveAttribute('src', /^data:image\/jpeg/);
    // The resized toast (not the plain "added") confirms the resize branch.
    await expect(page.getByText('Large image resized to fit')).toBeVisible();
  });
});
