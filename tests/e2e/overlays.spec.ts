/**
 * Overlays — command palette, quick open, snippets, developer utilities,
 * keyboard shortcuts, and What's New. These are tier-agnostic navigation
 * surfaces; a few of them have Pro-gated payloads and those bits are
 * covered from `proTierUnlocks.spec.ts`. Here we only cover open/close,
 * empty/loading states, and fuzzy-match behavior.
 */

import {
  closeActiveEditorTab,
  closeSettings,
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  expectNoticeContains,
  expectTier,
  gotoApp,
  openConsole,
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
    await expect(
      page
        .locator('[data-result-index]')
        .filter({ hasText: /Open Snippets/i })
        .first()
    ).toBeVisible();

    await paletteInput(page).fill('layout');
    await expect(page.getByRole('button', { name: /Layout: Horizontal Split/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Layout: Vertical Split/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Layout: Editor Only/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toBeHidden();
  });

  test("What's New palette entry opens the release notes overlay", async ({ page }) => {
    await openPaletteAction(page, 'whats new', /What's New/i);
    await expect(
      page.getByRole('heading', { name: 'Release notes and recent changes' })
    ).toBeVisible();
    await dismissWhatsNew(page);
  });

  test('developer utility aliases open the matching utility action', async ({ page }) => {
    await openPaletteAction(page, 'b64', /Open Base64 Encoder/i);

    await expect(page.getByRole('heading', { name: 'Base64 Encoder', exact: true })).toBeVisible();
    await closeDeveloperUtilities(page);
  });

  test('About palette entry routes into the About settings section', async ({ page }) => {
    await openPaletteAction(page, 'about', /About Lingua/i);
    await expect(page.getByText('About', { exact: true }).first()).toBeVisible();
    await closeSettings(page);
  });

  test('Editor Only layout preset hides the console panel', async ({ page }) => {
    // The console defaults to hidden, so first open it via the toolbar
    // toggle to establish the "console visible" baseline. Then Editor
    // Only should force it off regardless of `consoleVisible`.
    await createJavaScriptTab(page);
    await openConsole(page);
    await expect(page.getByTestId('execution-history-toggle')).toBeVisible();

    await openPaletteAction(page, 'editor only', /Layout: Editor Only/i);
    await expect(page.getByTestId('execution-history-toggle')).toHaveCount(0);
  });
});

test.describe('Quick open', () => {
  test('renders the empty "no project" hint when no project is open', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await closeActiveEditorTab(page);
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
    await expect(page.getByRole('button', { name: 'Seed snippet 1 Seeded snippet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Seed snippet 2 Seeded snippet' })).toBeVisible();

    await closeSnippets(page);
    // The tab the user was editing must still be focused.
    await expect(page.getByRole('button', { name: /JS .*\.js/i })).toBeVisible();
  });
});

test.describe('Developer utilities workspace (Pro)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
  });

  test('opens from the global Mod+K shortcut', async ({ page }) => {
    await page.getByTestId('action-pill-utilities').hover();
    await expect(page.getByRole('tooltip', { name: /Developer utilities/u })).toBeVisible();

    await page.keyboard.press('Control+K');
    await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
    await expect(page.getByTestId('utilities-search-input')).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('utility-item-base64')).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Base64 Encoder', exact: true })).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('utility-item-url')).toBeFocused();
    await expect(page.getByRole('heading', { name: 'URL Encoder', exact: true })).toBeVisible();

    await expect(
      page.getByRole('heading', { name: 'Built-in utilities', exact: true })
    ).toBeVisible();
    const utilitiesShortcuts = page.getByTestId('utilities-sidebar-shortcuts');
    await expect(utilitiesShortcuts).toContainText(/Copy output/u);
    await expect(utilitiesShortcuts).toContainText(/⌘⇧C|Ctrl\+Shift\+C/u);
    await expect(page.getByText('Copy output')).toBeVisible();
    await expect(page.getByText('Replace clipboard')).toBeHidden();

    await closeDeveloperUtilities(page);
  });

  test('filters by aliases and copies registered output through shortcuts', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDeveloperUtilities(page);

    await page.getByTestId('utilities-search-input').fill('b64');
    await expect(page.getByTestId('utility-item-base64')).toBeVisible();
    await page.getByTestId('utility-item-base64').click();
    await expect(page.getByRole('heading', { name: 'Base64 Encoder', exact: true })).toBeVisible();

    const expectedOutput = 'TGluZ3VhIHV0aWxpdGllcw==';

    await page.keyboard.press('Control+Shift+C');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(expectedOutput);
    await expect(
      page.getByText(/Output copied to clipboard · (⌘⇧C|Ctrl\+Shift\+C)/u)
    ).toBeVisible();

    await page.evaluate(() => navigator.clipboard.writeText('old clipboard'));
    const replaceShortcut = process.platform === 'darwin' ? 'Meta+Alt+R' : 'Control+Alt+R';
    await page.keyboard.press(replaceShortcut);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(expectedOutput);
    await expect(
      page.getByText(/Clipboard replaced with output · (⌘⌥R|Ctrl\+Alt\+R)/u)
    ).toBeVisible();

    await closeDeveloperUtilities(page);
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

  test('Beautify/Minify panel minifies HTML and preserves <pre> content', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Beautify \/ Minify/ }).click();

    await page.getByTestId('beautify-minify-language').selectOption('html');
    await page.getByTestId('beautify-minify-mode').selectOption('minify');
    await page
      .getByTestId('beautify-minify-input')
      .fill('<div>\n  <pre>keep  spaces</pre>\n  <span>hi</span>\n</div>');

    const output = page.getByTestId('beautify-minify-output');
    // Whitespace between tags collapses; <pre> content stays intact.
    await expect(output).toHaveValue('<div><pre>keep  spaces</pre><span>hi</span></div>');

    await closeDeveloperUtilities(page);
  });

  test('Beautify/Minify panel minifies SCSS with nested rules and // line comments', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Beautify \/ Minify/ }).click();

    await page.getByTestId('beautify-minify-language').selectOption('scss');
    await page.getByTestId('beautify-minify-mode').selectOption('minify');
    await page
      .getByTestId('beautify-minify-input')
      .fill('// header\n.outer {\n  color: red; // inline\n  .inner { padding: 1px 2px; }\n}');

    const output = page.getByTestId('beautify-minify-output');
    // Both // comments stripped, nested rule collapsed, trailing `;` before `}` dropped.
    await expect(output).toHaveValue('.outer{color:red;.inner{padding:1px 2px}}');

    await closeDeveloperUtilities(page);
  });

  test('Beautify/Minify panel minifies CSS and preserves url() + strings', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Beautify \/ Minify/ }).click();

    await page.getByTestId('beautify-minify-language').selectOption('css');
    await page.getByTestId('beautify-minify-mode').selectOption('minify');
    await page
      .getByTestId('beautify-minify-input')
      .fill(
        '/* header */\n.x {\n  color: red;\n  content: "  keep  spaces  ";\n  background: url("path.png");\n}'
      );

    const output = page.getByTestId('beautify-minify-output');
    await expect(output).toHaveValue(
      '.x{color:red;content:"  keep  spaces  ";background:url("path.png")}'
    );

    await closeDeveloperUtilities(page);
  });

  test('Beautify/Minify panel minifies XML and preserves CDATA + comments stripped', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Beautify \/ Minify/ }).click();

    await page.getByTestId('beautify-minify-language').selectOption('xml');
    await page.getByTestId('beautify-minify-mode').selectOption('minify');
    await page
      .getByTestId('beautify-minify-input')
      .fill('<!-- note --><root>\n  <child><![CDATA[  raw <tags>  ]]></child>\n</root>');

    const output = page.getByTestId('beautify-minify-output');
    await expect(output).toHaveValue('<root><child><![CDATA[  raw <tags>  ]]></child></root>');

    await closeDeveloperUtilities(page);
  });

  test('Hash Generator cycles through MD5 / SHA-384 / HMAC and produces the expected digests', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Hash Generator/ }).click();

    // Type a stable input, then swap algorithms to prove each lands.
    await page.getByTestId('hash-input-text').fill('abc');

    await page.getByTestId('hash-algorithm').selectOption('MD5');
    await expect(page.getByTestId('hash-output')).toHaveValue('900150983cd24fb0d6963f7d28e17f72');

    await page.getByTestId('hash-algorithm').selectOption('SHA-384');
    // SHA-384("abc") — canonical NIST test vector, 96 hex chars.
    await expect(page.getByTestId('hash-output')).toHaveValue(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7'
    );

    // Flip to HMAC mode; MD5 must be gone from the dropdown, a Key field
    // appears, and a seeded key produces the RFC-style vector.
    await page.getByTestId('hash-mode').selectOption('hmac');
    await page.getByTestId('hash-input-text').fill('The quick brown fox jumps over the lazy dog');
    await page.getByTestId('hash-hmac-key').fill('key');
    await page.getByTestId('hash-algorithm').selectOption('SHA-256');
    await expect(page.getByTestId('hash-output')).toHaveValue(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    );

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

  test('Base64 Image decode renders a pasted data-URI preview with metadata', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Base64 Image/ }).click();

    await page.getByTestId('base64-image-mode').selectOption('decode');

    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    await page.getByTestId('base64-image-decode-input').fill(dataUri);

    const preview = page.getByTestId('base64-image-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', dataUri);
    await expect(page.getByTestId('base64-image-metadata')).toContainText('image/png');

    // Switch to encode mode — dropzone is visible; no preview until a file lands.
    await page.getByTestId('base64-image-mode').selectOption('encode');
    await expect(page.getByTestId('base64-image-dropzone')).toBeVisible();
    await expect(page.getByTestId('base64-image-preview')).toHaveCount(0);

    await closeDeveloperUtilities(page);
  });

  test('Regex Tester Replace mode expands $1 / $2 back-references and reports the replacement count', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Regex Tester/ }).click();

    await page.getByTestId('regex-mode').selectOption('replace');

    // Seeded pattern `(\w+)@(\w+\.\w+)`, flags `g`, seeded test string
    // `hello@lingua.dev and support@example.com`. Override the
    // replacement field with a simple template that exercises both
    // numbered back-refs.
    await page.getByTestId('regex-replacement').fill('[$1 at $2]');

    const output = page.getByTestId('regex-replace-output');
    await expect(output).toHaveValue('[hello at lingua.dev] and [support at example.com]');
    await expect(page.getByTestId('regex-replace-count')).toContainText('2 replacements');

    // Switch back to Match mode — the replace output + count disappear.
    await page.getByTestId('regex-mode').selectOption('match');
    await expect(page.getByTestId('regex-replace-output')).toHaveCount(0);

    await closeDeveloperUtilities(page);
  });

  test('SVG to CSS converter emits a base64 data-URI with detected size hint and toggles to URL-encoded', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^SVG to CSS/ }).click();

    // Default: seeded SVG with width=24/height=24 in Base64 mode.
    const dataUri = page.getByTestId('svg-to-css-data-uri');
    await expect(dataUri).toHaveValue(/^data:image\/svg\+xml;base64,/);
    await expect(page.getByTestId('svg-to-css-size')).toContainText(/24.*24/);
    const cssBlock = page.getByTestId('svg-to-css-block');
    await expect(cssBlock).toContainText('background-image: url("data:image/svg+xml;base64,');
    await expect(cssBlock).toContainText('background-size: 24px 24px;');
    await expect(cssBlock).toContainText('background-repeat: no-repeat;');

    // Flip to URL-encoded and confirm the prefix changes.
    await page.getByTestId('svg-to-css-mode').selectOption('percent');
    await expect(dataUri).toHaveValue(/^data:image\/svg\+xml,%3Csvg/);
    await expect(cssBlock).not.toContainText(';base64,');

    await closeDeveloperUtilities(page);
  });

  test('Cron Parser explains a seeded cron expression and lists 5 upcoming runs', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Cron Parser/ }).click();

    // Default seed: "*/5 * * * *" with nextCount=5.
    await expect(page.getByTestId('cron-parser-input')).toHaveValue('*/5 * * * *');
    await expect(page.getByTestId('cron-parser-next-count')).toHaveValue('5');

    const description = page.getByTestId('cron-parser-description');
    await expect(description).toBeVisible();
    await expect(description).toHaveValue(/every 5 minutes/i);

    const rows = page.getByTestId('cron-parser-next-runs').locator('li');
    await expect(rows).toHaveCount(5);
    await expect(page.getByTestId('cron-parser-next-row-0')).toBeVisible();

    // Garbage input flips the right pane to the error banner and hides outputs.
    await page.getByTestId('cron-parser-input').fill('not a cron');
    await expect(page.getByTestId('cron-parser-description')).toHaveCount(0);
    await expect(page.getByText(/Invalid cron expression/i)).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('HTML to JSX converter translates class/for and self-closes void elements', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^HTML to JSX/ }).click();

    const output = page.getByTestId('html-to-jsx-output');
    await expect(output).toBeVisible();
    await expect(output).toHaveValue(/className="card"/);
    await expect(output).toHaveValue(/htmlFor="name"/);
    await expect(output).toHaveValue(/<br \/>/);
    await expect(output).toHaveValue(/\{\/\* a comment \*\/\}/);

    await closeDeveloperUtilities(page);
  });

  test('cURL to Code converter swaps between fetch, requests, and net-http targets', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^cURL to Code/ }).click();

    const output = page.getByTestId('curl-to-code-output');
    await expect(output).toHaveValue(/await fetch\("https:\/\/api\.example\.com\/users"/);

    await page.getByTestId('curl-to-code-target').selectOption('requests');
    await expect(output).toHaveValue(
      /requests\.request\("POST", "https:\/\/api\.example\.com\/users"/
    );

    await page.getByTestId('curl-to-code-target').selectOption('net-http');
    await expect(output).toHaveValue(/http\.NewRequest\("POST"/);

    await closeDeveloperUtilities(page);
  });

  test('YAML and JSON converter renders a comment-loss notice and toggles direction', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^YAML and JSON/ }).click();

    const output = page.getByTestId('yaml-json-output');
    await expect(output).toHaveValue(/"name": "lingua"/);
    await expect(page.getByTestId('yaml-json-comments-dropped')).toBeVisible();

    await page.getByTestId('yaml-json-mode').selectOption('json-to-yaml');
    await expect(output).toHaveValue(/name: lingua/);

    await closeDeveloperUtilities(page);
  });

  test('JSON and CSV converter dumps a header row by default and parses CSV back', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^JSON and CSV/ }).click();

    const output = page.getByTestId('json-csv-output');
    await expect(output).toHaveValue(/^name,score\nAlice,92/);
    await expect(page.getByTestId('json-csv-summary')).toContainText('3 rows');

    await page.getByTestId('json-csv-mode').selectOption('csv-to-json');
    await expect(output).toHaveValue(/"name": "Alice"/);

    await closeDeveloperUtilities(page);
  });

  test('Markdown Preview emits sanitized HTML for the seeded source', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Markdown Preview/ }).click();

    const html = page.getByTestId('markdown-preview-html');
    await expect(html).toHaveValue(/<h1>Hello, Lingua<\/h1>/);
    await expect(html).toHaveValue(/<strong>Markdown Preview<\/strong>/);

    await closeDeveloperUtilities(page);
  });

  test('SQL Formatter formats a SELECT and switches keyword case', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^SQL Formatter/ }).click();

    const output = page.getByTestId('sql-formatter-output');
    await expect(output).toHaveValue(/SELECT/);
    await expect(output).toHaveValue(/FROM/);

    await page.getByTestId('sql-formatter-keyword-case').selectOption('lower');
    await expect(output).toHaveValue(/^select/);

    await closeDeveloperUtilities(page);
  });

  test('Lorem Ipsum Generator mints 3 paragraphs opening with the canonical phrase', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Lorem Ipsum Generator/ }).click();

    // Defaults: unit = paragraphs, count = 3, classic-opening toggle on.
    await page.getByTestId('lorem-ipsum-generate').click();

    const output = page.getByTestId('lorem-ipsum-output');
    await expect(output).toBeVisible();
    const value = await output.inputValue();
    expect(value.startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')).toBe(true);
    expect(value.split('\n\n')).toHaveLength(3);

    await closeDeveloperUtilities(page);
  });

  test('Random String Generator mints a batch of 5 x 32-char values with the default charset', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Random String Generator/ }).click();

    // Default state: length 32, count 5, lowercase + uppercase + digits on.
    await page.getByTestId('random-string-generate').click();

    const rows = page.getByTestId(/^random-string-value-\d+$/);
    await expect(rows).toHaveCount(5);
    // Each value is 32 chars drawn from [A-Za-z0-9].
    for (let i = 0; i < 5; i += 1) {
      const text = (await rows.nth(i).locator('span').first().innerText()).trim();
      expect(text).toMatch(/^[A-Za-z0-9]{32}$/);
    }

    // Turning every charset class off disables Generate and shows the
    // translated empty-charset banner.
    await page.getByTestId('random-string-toggle-lowercase').click();
    await page.getByTestId('random-string-toggle-uppercase').click();
    await page.getByTestId('random-string-toggle-digits').click();
    await expect(page.getByTestId('random-string-error')).toBeVisible();
    await expect(page.getByTestId('random-string-generate')).toBeDisabled();

    await closeDeveloperUtilities(page);
  });

  test('Backslash Escape/Unescape round-trips and flags malformed input per preset', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Backslash Escape \/ Unescape/ }).click();

    const input = page.getByTestId('backslash-escape-input');
    const output = page.getByTestId('backslash-escape-output');

    // Default mode Escape + preset JavaScript. Fill, escape, round-trip.
    await input.fill('tab\there, quote "x"');
    await expect(output).toHaveValue('tab\\there, quote \\"x\\"');

    // Flip to Unescape, paste the output back, expect the original input.
    await page.getByTestId('backslash-escape-mode').selectOption('unescape');
    await input.fill('tab\\there, quote \\"x\\"');
    await expect(output).toHaveValue('tab\there, quote "x"');

    // Feed a malformed \x sequence — the error banner replaces the output.
    await input.fill('a\\x1');
    await expect(page.getByTestId('backslash-escape-error')).toContainText(
      'Expected two hex digits'
    );

    // Switch to Python preset, back to Escape, and verify octal-capable
    // behavior still reads the seeded control-char set correctly.
    await page.getByTestId('backslash-escape-mode').selectOption('escape');
    await page.getByTestId('backslash-escape-preset').selectOption('python');
    await input.fill('\n\t');
    await expect(output).toHaveValue('\\n\\t');

    // SQL preset surfaces the LIKE-wildcard hint.
    await page.getByTestId('backslash-escape-preset').selectOption('sql-mysql');
    await expect(page.getByText(/SQL LIKE wildcards/)).toBeVisible();

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
      page.locator('[data-testid="string-inspector-row"][data-category="invisible"]')
    ).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('QR Code panel renders a PNG preview and a working download link', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^QR Code/ }).click();

    const input = page.getByTestId('qr-code-input');
    await input.fill('https://linguacode.dev');

    // Preview image lands with a base64 PNG data URL, proving the helper
    // ran and produced a deterministic artefact.
    const image = page.getByTestId('qr-code-image');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);

    // Download anchor carries the same data URL + the expected filename.
    const download = page.getByTestId('qr-code-download');
    await expect(download).toHaveAttribute('download', 'qr-code.png');
    await expect(download).toHaveAttribute('href', /^data:image\/png;base64,/);

    // Flipping the correction level regenerates a distinct preview.
    const firstSrc = await image.getAttribute('src');
    await page.getByTestId('qr-code-level').selectOption('H');
    await expect(image).not.toHaveAttribute('src', firstSrc ?? '');

    // Clearing the payload hides the preview and surfaces the empty hint.
    await input.fill('');
    await expect(page.getByTestId('qr-code-image')).toHaveCount(0);

    await closeDeveloperUtilities(page);
  });

  test('JWT Debugger signs a token and verifies it via the mode toggle', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^JWT Debugger/ }).click();

    // Sign first: HS256 with a key that hits the 32-byte HMAC floor.
    await page.getByTestId('jwt-mode').selectOption('sign');
    await page.getByTestId('jwt-sign-key').fill('this-secret-is-exactly-32-bytes!');
    await page.getByTestId('jwt-sign-run').click();

    const signResult = page.getByTestId('jwt-sign-result');
    await expect(signResult).toBeVisible();
    const token = await signResult.inputValue();
    expect(token.split('.')).toHaveLength(3);

    // Verify: paste the same token + key, algorithm auto-stays on HS256
    // (the default). Expect the pass indicator.
    await page.getByTestId('jwt-mode').selectOption('verify');
    await page.getByTestId('jwt-verify-token').fill(token);
    await page.getByTestId('jwt-verify-key').fill('this-secret-is-exactly-32-bytes!');
    await page.getByTestId('jwt-verify-run').click();

    await expect(page.getByTestId('jwt-verify-result-pass')).toBeVisible();

    // Tamper one character in the token — verify should flip to fail.
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    await page.getByTestId('jwt-verify-token').fill(tampered);
    await page.getByTestId('jwt-verify-run').click();
    await expect(page.getByTestId('jwt-verify-result-fail')).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('JWT Debugger rounds-trips Sign → Verify for ES256 via Web Crypto', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^JWT Debugger/ }).click();

    // Generate an ECDSA P-256 keypair inside the page and export both
    // halves as JWK strings. The Web Crypto surface that the panel uses
    // is the same one the test runs in, so this is a faithful smoke.
    const keyMaterial = await page.evaluate(async () => {
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      );
      const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
      const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      return {
        privateJwk: JSON.stringify(privateJwk),
        publicJwk: JSON.stringify(publicJwk),
      };
    });

    // Sign with ES256 + the private JWK.
    await page.getByTestId('jwt-mode').selectOption('sign');
    await page.getByTestId('jwt-sign-algorithm').selectOption('ES256');
    await page.getByTestId('jwt-sign-key').fill(keyMaterial.privateJwk);
    await page.getByTestId('jwt-sign-run').click();

    const signResult = page.getByTestId('jwt-sign-result');
    await expect(signResult).toBeVisible();
    const token = await signResult.inputValue();
    expect(token.split('.')).toHaveLength(3);

    // Verify with ES256 + the public JWK → PASS.
    await page.getByTestId('jwt-mode').selectOption('verify');
    await page.getByTestId('jwt-verify-algorithm').selectOption('ES256');
    await page.getByTestId('jwt-verify-token').fill(token);
    await page.getByTestId('jwt-verify-key').fill(keyMaterial.publicJwk);
    await page.getByTestId('jwt-verify-run').click();

    await expect(page.getByTestId('jwt-verify-result-pass')).toBeVisible();

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
    await expect(page.getByTestId('diff-segment-add').first()).toBeVisible();

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

    await page.keyboard.press('ControlOrMeta+Shift+G');
    await expectNoticeContains(page, 'utility workflows');

    const dismiss = page.getByRole('button', { name: /dismiss notice/i });
    await dismiss.click();
    await expect(page.getByTestId('status-notice-banner')).toBeHidden();
  });
});
