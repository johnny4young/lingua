/**
 * implementation-β-β-α implementation note — sandboxed-iframe security e2e.
 *
 * Asserts that scripts running inside the `<RichValueHtml>` sandboxed
 * iframe cannot escape to mutate the parent renderer DOM. The
 * `<iframe sandbox="allow-scripts">` posture (no `allow-same-origin`)
 * puts the iframe in an opaque origin, so cross-origin DOM access
 * throws SecurityError. This spec exercises a malicious payload
 * end-to-end and verifies the parent body is untouched.
 *
 * The wire shape between worker → console → renderer is independently
 * covered by `tests/shared/richOutput.test.ts`; this spec only
 * validates the renderer-side iframe attribute is load-bearing.
 */

import type { ConsoleEntry } from '../../src/renderer/types';
import { expect, seedSession, test } from './licenseWeb.helpers';

type ConsoleEntrySeed = Omit<ConsoleEntry, 'id' | 'timestamp'>;

declare global {
  interface Window {
    __linguaE2e?: {
      clearConsole: () => void;
      addConsoleEntries: (entries: ConsoleEntrySeed[]) => void;
    };
  }
}

test('sandboxed HTML payload cannot mutate parent DOM (cross-origin write blocked)', async ({
  page,
}) => {
  await seedSession(page, { language: 'en' });
  await page.goto('/?e2e=rich-console-gallery');
  await expect(page.getByTestId('rich-console-e2e-fixture')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__linguaE2e))).toBe(true);

  // Tag the parent body with a known sentinel; the malicious payload
  // inside the iframe will try to overwrite it via cross-origin DOM
  // access. If sandbox enforcement works the sentinel survives.
  await page.evaluate(() => {
    document.body.dataset.linguaSecuritySentinel = 'pristine';
  });

  const maliciousHtml = `<!doctype html>
    <html>
      <body>
        <script>
          // Attempt cross-origin DOM mutation. Without
          // sandbox="allow-same-origin" this throws SecurityError
          // because the iframe runs in an opaque origin. We swallow
          // the throw — the test reads the sentinel afterwards.
          try {
            parent.document.body.dataset.linguaSecuritySentinel = 'breached';
          } catch (e) {
            // expected — cross-origin block
          }
          try {
            top.document.body.dataset.linguaSecuritySentinel = 'breached';
          } catch (e) {
            // expected — cross-origin block
          }
        </script>
        <p>sandbox probe</p>
      </body>
    </html>`;

  await page.evaluate((html) => {
    const hooks = window.__linguaE2e;
    if (!hooks) throw new Error('Missing Lingua E2E hooks');
    hooks.clearConsole();
    hooks.addConsoleEntries([
      {
        type: 'log',
        content: 'Sandbox probe',
        language: 'javascript',
        payload: [{ kind: 'html', height: 80, html }],
      },
    ]);
  }, maliciousHtml);

  // Confirm the iframe rendered with the expected sandbox token.
  const iframe = page.getByTestId('console-rich-html-iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');

  // Give the iframe script a beat to run + attempt the breach.
  await expect(
    page.frameLocator('[data-testid="console-rich-html-iframe"]').getByText('sandbox probe')
  ).toBeVisible();

  // Parent body sentinel must be unchanged. If sandbox flags ever
  // regress to include `allow-same-origin` this assertion fails.
  const sentinel = await page.evaluate(
    () => document.body.dataset.linguaSecuritySentinel
  );
  expect(sentinel).toBe('pristine');
});

test('counter-assertion: same payload WITH allow-same-origin DOES breach (proves the gate is load-bearing)', async ({
  page,
}) => {
  // This test exists to prove the previous test is not passing by
  // accident. We attach a hand-rolled iframe with the same srcdoc
  // payload but with `sandbox="allow-scripts allow-same-origin"`. The
  // breach MUST succeed. If this ever stops breaching, the test above
  // is no longer load-bearing and the original sentinel could be
  // staying pristine for unrelated reasons (e.g. iframe origin
  // discrepancy independent of sandbox).
  await page.goto('about:blank');
  const result = await page.evaluate(async () => {
    document.body.dataset.linguaSecuritySentinel = 'pristine';
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    const loaded = new Promise((resolve) => {
      iframe.addEventListener('load', () => resolve(null), { once: true });
    });
    iframe.srcdoc = `<!doctype html><html><body><script>
      try {
        parent.document.body.dataset.linguaSecuritySentinel = 'breached';
      } catch (e) { /* shouldn't throw with allow-same-origin */ }
    </script></body></html>`;
    document.body.appendChild(iframe);
    // Wait for the iframe load after the listener is installed; adding
    // the listener after append can miss the event in fast browsers.
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return document.body.dataset.linguaSecuritySentinel;
  });
  expect(result).toBe('breached');
});
