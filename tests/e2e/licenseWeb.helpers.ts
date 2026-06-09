import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test as base, type Locator, type Page, type Route } from '@playwright/test';

const repoRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  version: string;
};

const SETTINGS_KEY = 'lingua-settings';
const SNIPPETS_KEY = 'lingua-snippets';
const LICENSE_SERVER_HOST = 'https://licenses.linguacode.dev';
const LICENSE_SERVER_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type',
};

export const APP_VERSION = packageJson.version;
export const DEV_LICENSE_TOKEN = process.env.LINGUA_DEV_LICENSE_TOKEN;
export const DEFAULT_FONT_STACK = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

if (!DEV_LICENSE_TOKEN) {
  throw new Error('LINGUA_DEV_LICENSE_TOKEN was not set by the Playwright config.');
}

// -----------------------------------------------------------------------------
// Seeding & fixtures
// -----------------------------------------------------------------------------

type Locale = 'system' | 'en' | 'es';

type SeedOptions = {
  language?: Locale;
  snippetCount?: number;
  suppressWhatsNew?: boolean;
  /**
   * When true, the session is seeded with a Pro dev license already applied
   * at boot time. Use this for tests that only need Pro to exercise a
   * specific flow — the license-apply UI is covered separately by the
   * settings spec so duplicating the apply click here just burns seconds.
   */
  primeProLicense?: boolean;
};

type SeededSnippet = {
  id: string;
  language: string;
  label: string;
  description: string;
  code: string;
  createdAt: number;
};

function buildSeededSnippets(count: number): SeededSnippet[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `seed-snippet-${index + 1}`,
    language: 'javascript',
    label: `Seed snippet ${index + 1}`,
    description: 'Seeded snippet',
    code: `console.log(${index + 1});`,
    createdAt: Date.now() + index,
  }));
}

// RL-019 Slice 3 — when the BrowserPreview panel mounts its
// sandboxed iframe (`sandbox="allow-scripts"` without
// `allow-same-origin`), Chromium logs a SecurityError if any
// script inside the iframe tries to probe `navigator.serviceWorker`
// (some libraries do this defensively at boot). The error is
// benign for our threat model — the sandbox is the intent — so we
// filter that specific message out of the console-error gate.
const KNOWN_BENIGN_CONSOLE_ERROR_PATTERNS: RegExp[] = [
  /Service worker is disabled because the context is sandboxed/i,
  /Failed to read the '(localStorage|sessionStorage|serviceWorker)' property from 'Window'.*sandboxed/i,
  /document is sandboxed and lacks the 'allow-same-origin'/i,
];

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const isBenign = (text: string) =>
    KNOWN_BENIGN_CONSOLE_ERROR_PATTERNS.some(pattern => pattern.test(text));
  page.on('console', message => {
    if (message.type() === 'error') {
      const text = message.text();
      if (isBenign(text)) return;
      errors.push(text);
    }
  });
  page.on('pageerror', error => {
    if (isBenign(error.message)) return;
    errors.push(error.message);
  });
  return errors;
}

function buildE2eDevice(deviceId: string) {
  const now = Date.now();
  return {
    id: `device-${deviceId}`,
    deviceId,
    deviceName: 'E2E browser',
    os: 'web-chromium',
    surface: 'web',
    activatedAt: now,
    lastSeenAt: now,
  };
}

async function fulfillLicenseJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: LICENSE_SERVER_HEADERS,
    body: JSON.stringify(body),
  });
}

async function fulfillCorsPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false;
  await route.fulfill({
    status: 204,
    headers: LICENSE_SERVER_HEADERS,
  });
  return true;
}

async function installLicenseServerMock(page: Page): Promise<void> {
  // RL-065 Slice 5 — every e2e build now has `VITE_LINGUA_TELEMETRY_URL`
  // baked in (see playwright.license-web.config.mts). Tests that
  // grant consent (telemetry.spec.ts) install their own /telemetry
  // route to capture events; every other test seeds consent as
  // `declined`, so no fire is expected. Belt-and-suspenders: this
  // global stub returns 204 so an accidental fire never reaches the
  // real production worker.
  await page.route('**/updates.linguacode.dev/telemetry', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
      return;
    }
    await route.fulfill({
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });

  await page.route(`${LICENSE_SERVER_HOST}/licenses/status**`, async route => {
    if (await fulfillCorsPreflight(route)) return;

    const url = new URL(route.request().url());
    const deviceId = url.searchParams.get('deviceId') ?? 'e2e-device';
    const devices = { desktop: [], web: [buildE2eDevice(deviceId)] };
    await fulfillLicenseJson(route, {
      ok: true,
      licenseId: 'lic_e2e',
      status: 'active',
      tier: 'pro',
      expiresAt: null,
      supportWindowEndsAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      devices,
      deviceLimit: { desktop: 3, web: 3 },
      deviceRegistered: true,
    });
  });

  await page.route(`${LICENSE_SERVER_HOST}/licenses/activate`, async route => {
    if (await fulfillCorsPreflight(route)) return;

    let input: { deviceId?: string };
    try {
      input = route.request().postDataJSON() as { deviceId?: string };
    } catch {
      input = {};
    }
    const deviceId = input.deviceId ?? 'e2e-device';
    await fulfillLicenseJson(route, {
      ok: true,
      licenseId: 'lic_e2e',
      activated: true,
      idempotent: false,
      devices: { desktop: [], web: [buildE2eDevice(deviceId)] },
      deviceLimit: { desktop: 3, web: 3 },
    });
  });

  await page.route(`${LICENSE_SERVER_HOST}/licenses/devices/remove`, async route => {
    if (await fulfillCorsPreflight(route)) return;

    await fulfillLicenseJson(route, {
      ok: true,
      licenseId: 'lic_e2e',
      removed: true,
      devices: { desktop: [], web: [] },
      deviceLimit: { desktop: 3, web: 3 },
    });
  });
}

/**
 * Extended Playwright test fixture that fails any test which produces a
 * console error or page error. Every integration test in this repo runs
 * under this fixture — the zero-error bar is the first line of defense
 * against renderer regressions (Tailwind collisions, React warnings,
 * i18next missing-key warnings, etc.).
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  page: async ({ page }, use) => {
    await installLicenseServerMock(page);
    await use(page);
  },
  consoleErrors: [
    async ({ page }, use) => {
      const errors = trackConsoleErrors(page);
      await use(errors);
      expect(errors, errors.join('\n')).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function seedSession(page: Page, options: SeedOptions = {}): Promise<void> {
  const {
    language = 'system',
    snippetCount = 0,
    suppressWhatsNew = true,
    primeProLicense = false,
  } = options;

  await page.addInitScript(
    ({
      currentVersion,
      settingsKey,
      snippetsKey,
      licenseKey,
      seededLanguage,
      seededSnippets,
      shouldSuppressWhatsNew,
      seededLicenseToken,
    }) => {
      // Guard: only prime storage when it's empty. Init scripts run on
      // every navigation (including reloads), so re-seeding each time
      // would clobber settings the user toggled in the app — and that
      // would defeat persistence assertions after a reload.
      if (window.localStorage.getItem(settingsKey)) return;

      window.localStorage.clear();
      window.sessionStorage.clear();

      window.localStorage.setItem(
        settingsKey,
        JSON.stringify({
          state: {
            language: seededLanguage,
            lastSeenVersion: shouldSuppressWhatsNew ? currentVersion : null,
            suppressTourAutoStart: true,
            hasCompletedOnboardingFirstRun: true,
            hasCompletedOnboardingFirstSnippet: true,
            telemetryConsent: 'declined',
          },
          version: 0,
        })
      );

      window.localStorage.setItem(
        snippetsKey,
        JSON.stringify({
          state: {
            snippets: seededSnippets,
          },
          version: 0,
        })
      );

      if (seededLicenseToken) {
        window.localStorage.setItem(
          licenseKey,
          JSON.stringify({
            state: { token: seededLicenseToken },
            version: 0,
          })
        );
      }
    },
    {
      currentVersion: APP_VERSION,
      settingsKey: SETTINGS_KEY,
      snippetsKey: SNIPPETS_KEY,
      licenseKey: 'lingua-license',
      seededLanguage: language,
      seededSnippets: buildSeededSnippets(snippetCount),
      shouldSuppressWhatsNew: suppressWhatsNew,
      seededLicenseToken: primeProLicense ? (DEV_LICENSE_TOKEN ?? null) : null,
    }
  );
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('license-badge')).toBeVisible();
}

/**
 * Wait for the license badge to settle onto a specific tier. When
 * `primeProLicense` is set, the store rehydrates with the token then
 * kicks off an async revalidation — meaning the badge briefly shows
 * `FREE` before flipping to `PRO`. Any assertion that depends on the
 * tier being active must await this helper first.
 */
export async function expectTier(page: Page, tier: 'FREE' | 'PRO'): Promise<void> {
  await expect(page.getByTestId('license-badge')).toContainText(tier);
}

// -----------------------------------------------------------------------------
// Overlay navigation — bilingual role/testid helpers
// -----------------------------------------------------------------------------

export async function dismissWhatsNew(page: Page): Promise<void> {
  const closeButton = page
    .getByRole('button', { name: /close what's new|cerrar novedades/i })
    .first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

export async function openSettings(page: Page): Promise<void> {
  const trigger = page.getByTestId('action-pill-settings');
  const canClick = await trigger
    .click({ trial: true, timeout: 1000 })
    .then(() => true)
    .catch(() => false);
  if (canClick) {
    await trigger.click();
  } else {
    await page.keyboard.press('ControlOrMeta+Comma');
  }
  await expect(
    page.getByRole('heading', {
      name: /tune the shell, editor, and runtime defaults|ajusta el shell, el editor y los valores predeterminados del entorno/i,
    })
  ).toBeVisible();
}

type SettingsTabId =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'languages'
  | 'environment'
  | 'privacy'
  | 'account'
  | 'shortcuts'
  | 'plugins'
  | 'recovery';

export async function openSettingsTab(page: Page, tabId: SettingsTabId): Promise<void> {
  const tab = page.getByTestId(`settings-tab-${tabId}`);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export async function closeSettings(page: Page): Promise<void> {
  const settingsHeading = page.getByRole('heading', {
    name: /tune the shell, editor, and runtime defaults|ajusta el shell, el editor y los valores predeterminados del entorno/i,
  });

  if (!(await settingsHeading.isVisible().catch(() => false))) {
    return;
  }

  await page.keyboard.press('Escape');
  await expect(settingsHeading).toBeHidden();
}

export async function openConsole(page: Page): Promise<void> {
  const historyToggle = page.getByTestId('execution-history-toggle');
  if (await historyToggle.isVisible().catch(() => false)) {
    return;
  }

  const restore = page.getByTestId('bottom-panel-restore');
  if (await restore.isVisible().catch(() => false)) {
    await restore.click();
  } else {
    await page.getByRole('button', { name: /toggle console|alternar consola/i }).click();
  }
  await expect(historyToggle).toBeVisible();
}

export async function openQuickOpen(page: Page): Promise<void> {
  await page.getByTestId('action-pill-quick-open').click();
  await expect(page.getByPlaceholder(/go to file|ir al archivo/i)).toBeVisible();
}

export async function openCommandPalette(page: Page): Promise<void> {
  await page.getByRole('button', { name: /command palette|paleta de comandos/i }).click();
  await expect(paletteInput(page)).toBeVisible();
}

export function paletteInput(page: Page): Locator {
  return page.getByPlaceholder(
    /search templates, snippets, commands|buscar plantillas, fragmentos, comandos/i
  );
}

export async function openSnippets(page: Page): Promise<void> {
  await page.getByRole('button', { name: /snippets|fragmentos/i }).click();
  await expect(
    page.getByRole('button', { name: /save active tab|guardar pestaña activa/i })
  ).toBeVisible();
}

export async function closeSnippets(page: Page): Promise<void> {
  await page.getByRole('button', { name: /close snippets|cerrar fragmentos/i }).click();
  await expect(
    page.getByRole('button', { name: /save active tab|guardar pestaña activa/i })
  ).toBeHidden();
}

export async function openDeveloperUtilities(page: Page): Promise<void> {
  await page.getByRole('button', { name: /developer utilities|utilidades de desarrollo/i }).click();
  await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
}

export async function closeDeveloperUtilities(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /close utilities|cerrar utilities/i })
    .click({ force: true });
  await expect(page.getByTestId('developer-utilities-workspace')).toHaveCount(0);
}

/**
 * Open a palette entry by fuzzy search. The helper opens the palette,
 * types the query, and clicks the first matching action button — mirrors
 * the real "open overlay from the palette" flow users rely on.
 */
export async function openPaletteAction(
  page: Page,
  query: string,
  actionName: RegExp | string
): Promise<void> {
  await openCommandPalette(page);
  await paletteInput(page).fill(query);
  await page.getByRole('button', { name: actionName }).click();
}

// -----------------------------------------------------------------------------
// License flows
// -----------------------------------------------------------------------------

/**
 * Paste + apply the dev license minted by run-playwright-web-validation.mjs.
 * Asserts the license-clear button shows up (= active tier persisted) and
 * that the status pill reflects the expected copy.
 */
export async function applyDevLicense(page: Page, expectedStatus: RegExp | string): Promise<void> {
  if ((await page.getByTestId('license-input').count()) === 0) {
    await openSettingsTab(page, 'account');
  }
  await page
    .getByRole('textbox', { name: /paste a license token|pega un token de licencia/i })
    .fill(DEV_LICENSE_TOKEN);
  await page.getByRole('button', { name: /apply license|aplicar licencia/i }).click();
  await expect(page.getByTestId('license-clear')).toBeVisible();
  await expect(page.getByTestId('license-status-pill')).toContainText(expectedStatus);
}

export async function clearLicense(page: Page): Promise<void> {
  if ((await page.getByTestId('license-clear').count()) === 0) {
    await openSettingsTab(page, 'account');
  }
  await page.getByTestId('license-clear').click();
  await expect(page.getByTestId('license-status-pill')).toContainText(/Free|Gratis/i);
}

// -----------------------------------------------------------------------------
// Runtime waits & signals
// -----------------------------------------------------------------------------

/**
 * Waits for a finished manual run. The toolbar Run button flips to
 * `Running...` / `Ejecutando...` while a worker-backed execution is in
 * flight, and returns to its idle label once the lifecycle finally settles
 * `isRunning` back to false. Gating on the disappearance of that loading
 * label is more portable than parsing console text — it works regardless
 * of console visibility or whether the runner emitted a completion entry.
 *
 * Generous 30s timeout because the web build still does worker warmup on
 * the first run per session; subsequent runs are near-instant.
 */
export async function waitForRunCompleted(page: Page): Promise<void> {
  const runningButton = page.getByRole('button', {
    name: /^running\.\.\.$|^ejecutando\.\.\.$/i,
  });
  await expect(runningButton).toHaveCount(0, { timeout: 30_000 });
}

export async function clickRun(page: Page): Promise<void> {
  await page.getByTestId('action-pill-run').click();
}

export async function selectRuntimeMode(
  page: Page,
  mode: 'worker' | 'node' | 'browser-preview'
): Promise<void> {
  await page.getByTestId('action-pill-runtime').click();
  await page.getByTestId(`action-pill-runtime-option-${mode}`).click();
}

export async function selectWorkflowMode(
  page: Page,
  mode: 'run' | 'debug' | 'scratchpad'
): Promise<void> {
  await page.getByTestId('action-pill-run-menu').click();
  await page.getByTestId(`action-pill-workflow-option-${mode}`).click();
}

// -----------------------------------------------------------------------------
// Status notices & overflow
// -----------------------------------------------------------------------------

export async function expectNoticeContains(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByTestId('status-notice-banner').filter({ hasText: text })).toBeVisible();
}

/**
 * Dismiss any currently-showing notice. The banner auto-dismisses after a
 * few seconds, but tests that trigger multiple consecutive upsells need to
 * clear the current one first to guarantee `expectNoticeContains` is
 * asserting on the intended message.
 */
export async function dismissNotice(page: Page): Promise<void> {
  const dismissButton = page.getByRole('button', {
    name: /dismiss notice|descartar aviso/i,
  });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }
  await expect(page.getByTestId('status-notice-banner')).toBeHidden();
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(hasOverflow).toBe(false);
}

// -----------------------------------------------------------------------------
// Tab creation
// -----------------------------------------------------------------------------

/**
 * Click the "New JavaScript" (or localized equivalent) fast-path button.
 * This is the shortest path from "empty shell" to "a tab I can Run".
 *
 * The seeded `welcome.js` scratchpad already counts as a JS tab in some
 * onboarding paths, so we short-circuit when a JS tab is already on
 * screen — clicking the empty-state quick-start would time out
 * because the empty state never renders when a tab is open.
 */
export async function createJavaScriptTab(page: Page): Promise<void> {
  const existingJsTab = page.getByRole('button', { name: /JS .*\.js/i });
  if (
    await existingJsTab
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return;
  }
  const explicitNewButton = page.getByRole('button', {
    name: /new javascript|nuevo javascript/i,
  });
  if (await explicitNewButton.isVisible().catch(() => false)) {
    await explicitNewButton.click();
  } else {
    await page.getByTestId('empty-state-quick-start-javascript').click();
  }
  await expect(page.getByRole('button', { name: /JS .*\.js/i })).toBeVisible();
}

export async function createLanguageTab(
  page: Page,
  languageName: RegExp | string,
  tabName: RegExp
): Promise<void> {
  await page.getByTestId('action-pill-lang').click();
  await page.getByRole('menuitem', { name: languageName }).click();
  await expect(page.getByRole('button', { name: tabName }).last()).toBeVisible();
}

export async function closeActiveEditorTab(page: Page): Promise<void> {
  const activeTab = page
    .locator('[data-testid="editor-tab-activation"][aria-current="page"]')
    .first();
  const activeTabLabel = await activeTab.getAttribute('aria-label');
  if (!activeTabLabel) {
    return;
  }
  const fileName = activeTabLabel.replace(/^\S+\s+/, '');
  const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const closeButtonName = new RegExp(`^(Close|Cerrar) ${escapedFileName}$`, 'i');
  await page.getByRole('button', { name: closeButtonName }).click();
  await expect(page.getByRole('button', { name: closeButtonName })).toHaveCount(0);
}

export async function createAdditionalJavaScriptTab(page: Page): Promise<void> {
  await createLanguageTab(page, /^JavaScript\b/i, /JS .*\.js/i);
}

export async function createTypeScriptTab(page: Page): Promise<void> {
  await createLanguageTab(page, /^TypeScript\b/i, /TS .*\.ts/i);
}
