/**
 * Overlays — command palette, quick open, snippets, developer utilities,
 * keyboard shortcuts, and What's New. These are tier-agnostic navigation
 * surfaces; a few of them have Pro-gated payloads and those bits are
 * covered from `proTierUnlocks.spec.ts`. Here we only cover open/close,
 * empty/loading states, and fuzzy-match behavior.
 */

import {
  closeSettings,
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  expectNoticeContains,
  expectTier,
  gotoApp,
  openCommandPalette,
  openDeveloperUtilities,
  openPaletteAction,
  openQuickOpen,
  openSnippets,
  closeSnippets,
  closeDeveloperUtilities,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Command palette', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
  });

  test('opens and filters actions by fuzzy query', async ({ page }) => {
    await openCommandPalette(page);
    await paletteInput(page).fill('snippets');
    await expect(page.getByRole('button', { name: /Open Snippets/i })).toBeVisible();

    await paletteInput(page).fill('layout');
    await expect(
      page.getByRole('button', { name: /Layout: Horizontal Split/i })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Layout: Vertical Split/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Layout: Editor Only/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toBeHidden();
  });

  test('What\'s New palette entry opens the release notes overlay', async ({ page }) => {
    await openPaletteAction(page, 'whats new', /What's New/i);
    await expect(
      page.getByRole('heading', { name: 'Release notes and recent changes' })
    ).toBeVisible();
    await dismissWhatsNew(page);
  });

  test('About palette entry routes into the About settings section', async ({ page }) => {
    await openPaletteAction(page, 'about', /About Lingua/i);
    await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
    await closeSettings(page);
  });

  test('Editor Only layout preset hides the console panel', async ({ page }) => {
    // The console defaults to hidden, so first open it via the toolbar
    // toggle to establish the "console visible" baseline. Then Editor
    // Only should force it off regardless of `consoleVisible`.
    await createJavaScriptTab(page);
    await page.getByRole('button', { name: 'Toggle console (Cmd+\\)' }).click();
    await expect(page.getByTestId('execution-history-toggle')).toBeVisible();

    await openPaletteAction(page, 'editor only', /Layout: Editor Only/i);
    await expect(page.getByTestId('execution-history-toggle')).toHaveCount(0);
  });
});

test.describe('Quick open', () => {
  test('renders the empty "no project" hint when no project is open', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openQuickOpen(page);
    await expect(page.getByText('No files open. Open a project to browse files.')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('shows open tabs in the list once tabs exist', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await createJavaScriptTab(page);
    await openQuickOpen(page);
    await expect(page.getByText('1 file')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test.describe('Snippets modal', () => {
  test('open/close cycles and preserves the tab bar state', async ({ page }) => {
    await seedSession(page, { language: 'en', snippetCount: 2 });
    await gotoApp(page);
    await createJavaScriptTab(page);

    await openSnippets(page);
    await expect(page.getByRole('button', { name: 'Save Active Tab' })).toBeVisible();
    // Seeded snippets must be in the list (proves store rehydration). Scope
    // to the sidebar buttons so we don't collide with the detail heading
    // that repeats the label once a snippet is selected.
    await expect(
      page.getByRole('button', { name: 'Seed snippet 1 Seeded snippet' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Seed snippet 2 Seeded snippet' })
    ).toBeVisible();

    await closeSnippets(page);
    // The tab the user was editing must still be focused.
    await expect(page.getByRole('tab', { name: /JS .*\.js/i })).toBeVisible();
  });
});

test.describe('Developer utilities modal (Pro)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
  });

  test('Beautify/Minify panel round-trips JSON', async ({ page }) => {
    await openDeveloperUtilities(page);
    // Sidebar buttons use the `titleLabel` i18n key, not the command
    // palette `label` — accessible name starts with the utility title.
    await page.getByRole('button', { name: /^Beautify \/ Minify/ }).click();

    await page.getByTestId('beautify-minify-language').selectOption('json');
    await page.getByTestId('beautify-minify-mode').selectOption('minify');
    await page.getByTestId('beautify-minify-input').fill('{\n  "a": 1\n}');

    const output = page.getByTestId('beautify-minify-output');
    await expect(output).toHaveValue('{"a":1}');

    await closeDeveloperUtilities(page);
  });

  test('UUID Generator produces a value and the decoder recognizes it', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^UUID Generator/ }).click();

    // The panel renders a batch of identifiers at once — scope to the
    // first so we get a deterministic single cell to assert on.
    const firstValue = page.getByTestId('uuid-generated-value').first();
    await expect(firstValue).not.toBeEmpty();

    // Each generated value ships with its own copy affordance alongside
    // the identifier text — a non-negotiable for a "mock data" utility.
    await expect(page.getByTestId('uuid-generated-value-copy-0')).toBeVisible();

    // Switching to v7 should regenerate with the v7 structural shape.
    await page.getByTestId('uuid-version-select').selectOption('v7');
    const v7 = (await firstValue.textContent())?.trim() ?? '';
    expect(v7).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Decoder round-trip — paste the v7 and see its embedded timestamp.
    await page.getByTestId('uuid-decoder-input').fill(v7);
    await expect(page.getByTestId('uuid-decoder-result')).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('String Case Converter emits every casing from a single input', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^String Case Converter/ }).click();

    const input = page.getByTestId('string-case-input');
    await input.fill('parseJSONValue');

    await expect(page.getByTestId('string-case-camel')).toHaveText('parseJsonValue');
    await expect(page.getByTestId('string-case-snake')).toHaveText('parse_json_value');
    await expect(page.getByTestId('string-case-constant')).toHaveText('PARSE_JSON_VALUE');
    await expect(page.getByTestId('string-case-kebab')).toHaveText('parse-json-value');
    await expect(page.getByTestId('string-case-camel-copy')).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('Timestamp Converter outputs every card with a copy button', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Timestamp Converter/ }).click();

    for (const testid of [
      'timestamp-output-seconds',
      'timestamp-output-milliseconds',
      'timestamp-output-iso',
      'timestamp-output-local',
    ]) {
      await expect(page.getByTestId(testid)).toBeVisible();
      await expect(page.getByTestId(`${testid}-copy`)).toBeVisible();
    }

    await closeDeveloperUtilities(page);
  });

  test('HTML Entity encode/decode mode swaps the output live', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^HTML Entity/ }).click();

    const input = page.getByTestId('html-entity-input');
    const output = page.getByTestId('html-entity-output');
    await input.fill('<p>© ñ</p>');

    // Default is `encode-named` — output should contain named entities.
    await expect(output).toHaveValue('&lt;p&gt;&copy; &ntilde;&lt;/p&gt;');

    // Switch to numeric — named entities become decimal references.
    await page.getByTestId('html-entity-mode').selectOption('encode-numeric');
    await expect(output).toHaveValue('&lt;p&gt;&#169; &#241;&lt;/p&gt;');

    // Decode mode resolves the references back to the original text.
    await page.getByTestId('html-entity-mode').selectOption('decode');
    await input.fill('&lt;p&gt;&copy; &ntilde;&lt;/p&gt;');
    await expect(output).toHaveValue('<p>© ñ</p>');

    await closeDeveloperUtilities(page);
  });

  test('String Inspector surfaces counts and a zero-width warning inline', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^String Inspector/ }).click();

    const input = page.getByTestId('string-inspector-input');
    await input.fill('hi');
    await expect(page.getByTestId('string-inspector-graphemes')).toHaveText('2');

    // Drop a zero-width space — the warnings card should appear with the
    // dedicated kind-scoped testid.
    await input.fill('a\u200Bb');
    await expect(page.getByTestId('string-inspector-warning-zero-width')).toBeVisible();
    await expect(page.getByTestId('string-inspector-graphemes')).toHaveText('3');
    // The invisible character becomes a dedicated row with category=invisible.
    await expect(
      page.locator('[data-testid="string-inspector-row"][data-category="invisible"]'),
    ).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('Diff Viewer granularity selector swaps between line, word and char modes', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Diff Viewer/ }).click();

    // Default granularity is "line" — the grouped rows are rendered.
    await expect(page.getByTestId('diff-result-line')).toBeVisible();

    await page.getByTestId('diff-granularity-select').selectOption('word');
    await expect(page.getByTestId('diff-result-inline')).toBeVisible();
    await expect(page.getByTestId('diff-result-line')).toHaveCount(0);
    // The seeded inputs introduce new words on the right side — at least
    // one `add` segment must render inline.
    await expect(
      page.getByTestId('diff-segment-add').first()
    ).toBeVisible();

    await page.getByTestId('diff-granularity-select').selectOption('character');
    await expect(page.getByTestId('diff-result-inline')).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('URL Parser breaks a URL into components and a query table', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^URL Parser/ }).click();

    // Default sample URL is already loaded — the live parse should
    // populate every readout. Flip to a new URL to prove the parser
    // reacts to input changes, then inspect the deterministic pieces.
    const input = page.getByTestId('url-parser-input');
    await input.fill('https://example.com:9000/search?q=dev&q=web');

    await expect(page.getByTestId('url-parser-hostname')).toHaveText('example.com');
    await expect(page.getByTestId('url-parser-port')).toHaveText('9000');
    await expect(page.getByTestId('url-parser-pathname')).toHaveText('/search');
    await expect(page.getByTestId('url-parser-query-row')).toHaveCount(2);

    // Invalid input short-circuits to the error copy and hides the
    // component grid so users are not left with stale values.
    await input.fill('not a url');
    await expect(page.getByText('That string is not a valid URL.')).toBeVisible();
    await expect(page.getByTestId('url-parser-hostname')).toHaveCount(0);

    await closeDeveloperUtilities(page);
  });

  test('Number Base Converter keeps bin/oct/dec/hex in sync', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Number Base Converter/ }).click();

    // Each view is a single input with a stable testid — using testids is
    // more reliable than role + name here because the labels are i18n'd
    // and can collide with other aria-labels in the panel.
    const hex = page.getByTestId('number-base-input-hex');
    const decimal = page.getByTestId('number-base-input-decimal');
    const binary = page.getByTestId('number-base-input-binary');

    await hex.fill('ff');
    // The store owns the bigint; blur forces the draft to reconcile with
    // formatted output. Commit by tabbing out.
    await hex.press('Tab');

    await expect(decimal).toHaveValue('255');
    await expect(binary).toHaveValue('11111111');

    await closeDeveloperUtilities(page);
  });
});

test.describe('Keyboard shortcuts modal', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
  });

  test('opens, filters, and exposes preset/export/import controls', async ({ page }) => {
    await openPaletteAction(page, 'keyboard', /Open Keyboard Shortcuts/i);
    await expect(page.getByTestId('keyboard-shortcuts-modal')).toBeVisible();
    await expect(page.getByTestId('shortcut-preset-select')).toBeVisible();
    await expect(page.getByTestId('shortcut-export')).toBeVisible();
    await expect(page.getByTestId('shortcut-import')).toBeVisible();
    await expect(page.getByTestId('shortcut-reset-all')).toBeVisible();

    // The command-palette row must be present — its testid is deterministic.
    await expect(page.getByTestId('shortcut-edit-overlay-command-palette')).toBeVisible();

    await page.getByRole('button', { name: /close keyboard shortcuts/i }).click();
    await expect(page.getByTestId('keyboard-shortcuts-modal')).toBeHidden();
  });

  test('Sublime preset rewrites the Go-to-symbol combo to Mod+R', async ({ page }) => {
    await openPaletteAction(page, 'keyboard', /Open Keyboard Shortcuts/i);

    // Default combo is Mod+Shift+O — the Go-to-symbol row reflects it.
    const goToSymbolRow = page.locator(
      '[data-testid="keyboard-shortcuts-modal"] >> li:has([data-testid="shortcut-edit-nav-go-to-symbol"])'
    );
    await expect(goToSymbolRow).toContainText(/⇧|Shift/);

    await page.getByTestId('shortcut-preset-select').selectOption('sublime');

    // After Sublime applies, the row's combo includes R (Mod+R).
    await expect(goToSymbolRow).toContainText('R');

    // Reset to restore default combos and confirm the round-trip.
    await page.getByTestId('shortcut-preset-select').selectOption('default');
    await expect(goToSymbolRow).toContainText(/⇧|Shift/);

    await page.getByRole('button', { name: /close keyboard shortcuts/i }).click();
  });
});

test.describe('Upsell notice banner', () => {
  test('can be dismissed via the × button before the auto-timer fires', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await expectTier(page, 'FREE');

    await page.getByRole('button', { name: 'Developer utilities' }).click();
    await expectNoticeContains(page, 'built-in developer utilities');

    const dismiss = page.getByRole('button', { name: /dismiss notice/i });
    await dismiss.click();
    await expect(page.getByTestId('status-notice-banner')).toBeHidden();
  });
});
