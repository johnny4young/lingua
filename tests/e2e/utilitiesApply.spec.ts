/**
 * RL-069 Slice 2 — Functional smoke for the ⚡ Apply-from-input
 * gesture and the Mod+Shift+A shortcut. Drives the real preview build
 * (`pnpm run preview:web`) through the full Developer Utilities flow
 * across multiple panel shapes and asserts both visual state and
 * console cleanliness.
 *
 * The user explicitly required this smoke as a blocking gate: the
 * slice does not close until every assertion below stays green.
 *
 * Base Developer Utilities are Free; this suite keeps seeding Pro so
 * it also protects the paid workflow layer that shares the same surface.
 */

import {
  closeDeveloperUtilities,
  expect,
  expectTier,
  gotoApp,
  openDeveloperUtilities,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('RL-069 Slice 2 — Apply gesture smoke', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
  });

  test('JSON: Apply enabled with seeded valid input, click + Cmd+Shift+C copies output', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await expect(page.getByRole('heading', { level: 2, name: 'JSON Formatter' })).toBeVisible();

    // The default seed is valid JSON — Apply must be enabled.
    const apply = page.getByTestId('utility-apply-button');
    await expect(apply).toBeEnabled();

    // Click Apply — the input is already formatted, so visible state
    // doesn't change but the descriptor's `run` fires without error.
    await apply.click();

    // Cmd+Shift+C copies the formatted output via the global shortcut.
    await page.keyboard.press('Meta+Shift+C');
    await expect(page.getByText(/Output copied to clipboard|Salida copiada/i)).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('Base64: switching to the panel reveals the Apply toolbar', async ({ page }) => {
    await openDeveloperUtilities(page);

    await page.getByTestId('utility-item-base64').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Base64 Encoder' })).toBeVisible();

    // The default seed is plain text. Apply may or may not be enabled
    // depending on whether the seed accidentally satisfies the base64
    // shape — we only assert the toolbar exists, which proves the
    // panel wired UtilityToolbar.
    await expect(page.getByTestId('utility-apply-button')).toBeVisible();
  });

  test('Random String: pure generator panel exposes no Apply button', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-item-random-string').click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Random String Generator' })
    ).toBeVisible();

    await expect(page.getByTestId('utility-apply-button')).toHaveCount(0);
  });

  test('Lorem Ipsum: pure generator panel exposes no Apply button', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-item-lorem-ipsum').click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Lorem Ipsum Generator' })
    ).toBeVisible();

    await expect(page.getByTestId('utility-apply-button')).toHaveCount(0);
  });

  test('UUID: Apply is disabled with empty decoder, enabled with a valid UUID pasted', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-item-uuid').click();
    await expect(page.getByRole('heading', { level: 2, name: 'UUID Generator' })).toBeVisible();

    const apply = page.getByTestId('utility-apply-button');
    await expect(apply).toBeDisabled();

    // Paste a UUID into the decoder field — Apply should enable.
    await page.getByTestId('uuid-decoder-input').fill('550e8400-e29b-41d4-a716-446655440000');
    await expect(apply).toBeEnabled();
  });

  test('Diff: dual-input panel keeps Apply gated on both panes filled', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-item-diff').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Diff Viewer' })).toBeVisible();

    const apply = page.getByTestId('utility-apply-button');
    // Both default seeds non-empty.
    await expect(apply).toBeEnabled();

    await page.getByLabel('Updated').fill('');
    await expect(apply).toBeDisabled();

    await page.getByLabel('Updated').fill('different content');
    await expect(apply).toBeEnabled();
  });

  test('Mod+Shift+A: shortcut fires the focused panel Apply with localized toast', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    // JSON panel is the default; Apply is enabled with the seeded payload.
    await page.keyboard.press('Meta+Shift+A');

    await expect(page.getByText(/Applied JSON Formatter|Apliqué Formateador JSON/i)).toBeVisible({
      timeout: 4000,
    });
  });

  test('Spanish locale: the Apply label uses neutral LatAm tuteo', async ({ browser }) => {
    // The outer beforeEach seeded English; reuse the browser context but
    // re-seed in es so the panel renders the localized button.
    const ctx = await browser.newContext();
    const esPage = await ctx.newPage();
    try {
      await seedSession(esPage, { language: 'es', primeProLicense: true });
      await gotoApp(esPage);
      await expectTier(esPage, 'PRO');
      await openDeveloperUtilities(esPage);

      await expect(esPage.getByRole('button', { name: /Aplica desde la entrada/i })).toBeVisible({
        timeout: 6000,
      });

      await esPage.keyboard.press('Meta+Shift+A');
      await expect(esPage.getByText(/Apliqué.*a la entrada actual/i)).toBeVisible({
        timeout: 4000,
      });
    } finally {
      await ctx.close();
    }
  });

  test('console stays clean across the full Apply flow', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await openDeveloperUtilities(page);

    // Touch every shape we ship Apply for: live transform, mode-flip,
    // dual-input, generator (no Apply but mounts the toolbar shell on
    // its parent), and structure-detect. The act of mounting +
    // unmounting must not throw.
    for (const id of [
      'json',
      'base64',
      'url',
      'jwt',
      'uuid',
      'hash',
      'timestamp',
      'regex',
      'diff',
      'color',
      'qr-code',
      'random-string',
      'lorem-ipsum',
    ]) {
      await page.getByTestId(`utility-item-${id}`).click();
    }

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
