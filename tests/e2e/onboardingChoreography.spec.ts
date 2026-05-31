/**
 * RL-101 Slice 1.5 fold C — end-to-end smoke for the onboarding
 * choreography that wasn't covered by Slice 1's unit tests. The
 * Slice 1 reviewer pass surfaced the visual toast-clobber bug that
 * 188 unit tests missed because they couldn't observe runtime
 * notice replacement under real boot timing — this e2e spec walks
 * a fresh install through all three stages (welcome seed, first-run
 * toast, first-snippet toast), asserts the bottom-right banner is
 * actually visible at each stage, and proves the priority-respecting
 * `pushStatusNotice` fix prevents the regression.
 *
 * The spec deliberately uses NO localStorage manipulation between
 * stages — the only re-arm path the user has is the
 * Settings → Onboarding toggles (covered separately by the unit
 * tests). Each test starts from a fully-cleared session so the
 * choreography runs end-to-end exactly the way a new user would
 * see it on first install.
 */
import {
  APP_VERSION,
  dismissWhatsNew,
  expect,
  gotoApp,
  test,
} from './licenseWeb.helpers';

test.describe('RL-101 Onboarding choreography', () => {
  test('fresh install seeds the welcome scratchpad with the JavaScript demo', async ({
    page,
  }) => {
    await page.addInitScript(
      ({ settingsKey, currentVersion }) => {
        window.localStorage.clear();
        // Suppress the tour + What's New so the choreography is the
        // only thing competing for the chrome on boot. Onboarding
        // flags stay unset so all three stages are armed.
        window.localStorage.setItem(
          settingsKey,
          JSON.stringify({
            state: {
              language: 'en',
              lastSeenVersion: currentVersion,
              suppressTourAutoStart: true,
              hasCompletedTour: true,
              telemetryConsent: 'declined',
            },
            version: 0,
          })
        );
      },
      { settingsKey: 'lingua-settings', currentVersion: APP_VERSION }
    );

    await gotoApp(page);
    await dismissWhatsNew(page);

    // Tab strip should carry the seeded welcome.js tab as the only
    // entry; the title bar mirrors the active tab name.
    await expect(
      page.getByTestId('editor-tab-activation').filter({ hasText: /welcome\.js/u })
    ).toBeVisible();
    await expect(
      page.locator('.monaco-editor').getByText(/console\.table\(/u)
    ).toBeVisible();
  });

  test('first successful run fires the Save-as-snippet toast with high priority', async ({
    page,
  }) => {
    await page.addInitScript(
      ({ settingsKey, currentVersion }) => {
        window.localStorage.clear();
        window.localStorage.setItem(
          settingsKey,
          JSON.stringify({
            state: {
              language: 'en',
              lastSeenVersion: currentVersion,
              suppressTourAutoStart: true,
              hasCompletedTour: true,
              telemetryConsent: 'declined',
            },
            version: 0,
          })
        );
      },
      { settingsKey: 'lingua-settings', currentVersion: APP_VERSION }
    );

    await gotoApp(page);
    await dismissWhatsNew(page);

    // The welcome.js seed auto-runs in Scratchpad mode; the
    // post-first-successful-run toast lands once the console store
    // accepts the run's last entry (the one carrying
    // `executionTime`). Slice 1.5 fold B's `'high'` priority guards
    // it against any normal-priority boot notice (the regression
    // this slice fixes).
    const banner = page.getByTestId('status-notice-banner');
    await expect(banner).toBeVisible({ timeout: 6_000 });
    await expect(banner).toContainText(/First run done/i);
    await expect(
      banner.getByRole('button', { name: /Save as snippet/i })
    ).toBeVisible();
  });

  test('clicking Save as snippet creates the snippet and surfaces the library tip', async ({
    page,
  }) => {
    await page.addInitScript(
      ({ settingsKey, currentVersion }) => {
        window.localStorage.clear();
        window.localStorage.setItem(
          settingsKey,
          JSON.stringify({
            state: {
              language: 'en',
              lastSeenVersion: currentVersion,
              suppressTourAutoStart: true,
              hasCompletedTour: true,
              telemetryConsent: 'declined',
            },
            version: 0,
          })
        );
      },
      { settingsKey: 'lingua-settings', currentVersion: APP_VERSION }
    );

    await gotoApp(page);
    await dismissWhatsNew(page);

    const firstRunBanner = page.getByTestId('status-notice-banner');
    await expect(firstRunBanner).toBeVisible({ timeout: 6_000 });
    await firstRunBanner
      .getByRole('button', { name: /Save as snippet/i })
      .click();

    // Toast 2 replaces toast 1 with the library tip. The shortcut
    // interpolation differs by platform (Cmd vs Ctrl) so we assert the
    // stable saved/reopen copy plus the CTA.
    await expect(firstRunBanner).toContainText(/Saved\. Reopen it from Snippets/i);
    await expect(
      firstRunBanner.getByRole('button', { name: /Open snippets/i })
    ).toBeVisible();
  });

  test('clicking Open snippets opens the SnippetsModal with the saved snippet visible', async ({
    page,
  }) => {
    await page.addInitScript(
      ({ settingsKey, currentVersion }) => {
        window.localStorage.clear();
        window.localStorage.setItem(
          settingsKey,
          JSON.stringify({
            state: {
              language: 'en',
              lastSeenVersion: currentVersion,
              suppressTourAutoStart: true,
              hasCompletedTour: true,
              telemetryConsent: 'declined',
            },
            version: 0,
          })
        );
      },
      { settingsKey: 'lingua-settings', currentVersion: APP_VERSION }
    );

    await gotoApp(page);
    await dismissWhatsNew(page);

    const banner = page.getByTestId('status-notice-banner');
    await expect(banner).toBeVisible({ timeout: 6_000 });
    await banner.getByRole('button', { name: /Save as snippet/i }).click();
    await expect(banner).toContainText(/Saved\. Reopen it from Snippets/i);
    await banner.getByRole('button', { name: /Open snippets/i }).click();

    // SnippetsModal renders with the saved snippet at the top of
    // the list (default-label is the active tab name per fold C).
    const snippetsDialog = page.getByRole('dialog', { name: /snippets/i });
    await expect(snippetsDialog).toBeVisible();
    await expect(snippetsDialog).toContainText(/welcome\.js/u);
  });

  test('Spanish locale renders both toasts in tuteo without voseo leaks', async ({
    page,
  }) => {
    await page.addInitScript(
      ({ settingsKey, currentVersion }) => {
        window.localStorage.clear();
        window.localStorage.setItem(
          settingsKey,
          JSON.stringify({
            state: {
              language: 'es',
              lastSeenVersion: currentVersion,
              suppressTourAutoStart: true,
              hasCompletedTour: true,
              telemetryConsent: 'declined',
            },
            version: 0,
          })
        );
      },
      { settingsKey: 'lingua-settings', currentVersion: APP_VERSION }
    );

    await gotoApp(page);
    await dismissWhatsNew(page);

    const banner = page.getByTestId('status-notice-banner');
    await expect(banner).toBeVisible({ timeout: 6_000 });
    // Tuteo: "Quieres" (not "Querés"); "Guarda" (not "Guardá");
    // "Vuelve" (not "Volvé"); "Abre" (not "Abrí"). Validating
    // the imperative form prevents accidental voseo drift in
    // future copy edits.
    await expect(banner).toContainText(/Quieres guardarlo/u);
    await expect(banner).not.toContainText(/Quer[éé]s/u);
    await expect(
      banner.getByRole('button', { name: /Guarda como snippet/u })
    ).toBeVisible();

    await banner
      .getByRole('button', { name: /Guarda como snippet/u })
      .click();
    await expect(banner).toContainText(/Vuelve a abrirlo desde Fragmentos/u);
    await expect(banner).not.toContainText(/Volv[ée] a abrirlo/u);
    await expect(
      banner.getByRole('button', { name: /Abre fragmentos/u })
    ).toBeVisible();
  });
});
