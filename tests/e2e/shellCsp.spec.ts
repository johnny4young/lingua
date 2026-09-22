import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';

// No app or service worker runs in this minimal shell fixture. Avoid Playwright's
// serviceWorkers:block init script, which itself throws in opaque frames.
test.use({ serviceWorkers: 'allow' });

// Deliberate CSP violations belong to this isolated negative probe, not the
// normal app fixture's zero-unexpected-console-errors allowlist.
test('emitted shell rejects inline injection while user sandbox executes without network access', async ({
  page,
}) => {
  const root = path.resolve('dist/web');
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const meta = html.match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/)![0];
  const bootstrap = html.match(/<script id="lingua-theme-bootstrap">[\s\S]*?<\/script>/)![0];
  const asset = (await readdir(path.join(root, 'assets'))).find(name =>
    /^lingua-sandbox-[\w-]+\.htm$/.test(name)
  );
  expect(asset).toBeDefined();
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const networkAttempts: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/__csp_probe', route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head>${meta}${bootstrap}</head><body></body></html>`,
    })
  );
  await page.route('https://lingua-csp-probe.invalid/**', route => {
    networkAttempts.push(route.request().url());
    return route.abort();
  });
  await page.goto('/__csp_probe');
  const result = await page.evaluate(async asset => {
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', event =>
      violations.push(event.effectiveDirective)
    );
    const injection = document.createElement('script');
    injection.textContent = 'document.body.dataset.shellInjected = "yes"';
    document.body.append(injection);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    const token = crypto.randomUUID();
    const result = await new Promise<{
      executed: boolean;
      isolated: boolean;
      fetchBlocked: boolean;
    }>((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', receive);
        reject(new Error('Missing sandbox result'));
      }, 10000);
      function receive(event: MessageEvent) {
        if (
          event.source !== iframe.contentWindow ||
          event.origin !== 'null' ||
          event.data?.token !== token
        )
          return;
        if (event.data.type === 'lingua-sandbox-ready') {
          iframe.contentWindow!.postMessage(
            {
              type: 'lingua-sandbox-document',
              token,
              html: `<script>
            let isolated = false;
            try { parent.document.body.dataset.breached = 'yes'; } catch { isolated = true; }
            fetch('https://lingua-csp-probe.invalid/').then(() => false, () => true).then(fetchBlocked => {
              parent.postMessage({ type: 'probe-result', token: ${JSON.stringify(token)}, executed: true, isolated, fetchBlocked }, '*');
            });
          </script>`,
            },
            '*'
          );
        } else if (event.data.type === 'probe-result') {
          clearTimeout(timer);
          window.removeEventListener('message', receive);
          resolve(event.data);
        }
      }
      window.addEventListener('message', receive);
      iframe.src = `/assets/${asset}?load=${token}`;
      document.body.append(iframe);
    });
    iframe.remove();
    return {
      ...result,
      violations,
      injected: document.body.dataset.shellInjected,
      breached: document.body.dataset.breached,
    };
  }, asset!);
  expect(result).toMatchObject({
    executed: true,
    isolated: true,
    fetchBlocked: true,
    injected: undefined,
    breached: undefined,
  });
  expect(result.violations).toContain('script-src-elem');
  expect(networkAttempts).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(errors.filter(error => error.startsWith('Executing inline script violates'))).toHaveLength(
    1
  );
  expect(
    errors.filter(error =>
      error.startsWith("Connecting to 'https://lingua-csp-probe.invalid/' violates")
    )
  ).toHaveLength(1);
  expect(
    errors.filter(error =>
      error.startsWith('Fetch API cannot load https://lingua-csp-probe.invalid/')
    )
  ).toHaveLength(1);
  expect(errors).toHaveLength(3);
});
