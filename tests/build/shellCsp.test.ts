// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build, resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const cases = [
  ['vite.renderer.config.mts', 'index.html'],
  ['vite.web.config.mts', 'src/web/index.html'],
] as const;

for (const [configFile, entry] of cases) {
  describe(`emitted shell CSP: ${entry}`, () => {
    it('authorizes the exact prepaint bootstrap without permitting arbitrary inline code', async () => {
      const config = await resolveConfig(
        { configFile: path.join(root, configFile), logLevel: 'silent' },
        'build'
      );
      const plugin = config.plugins.find(plugin => plugin.name === 'lingua-shell-csp');
      const source = await readFile(path.join(root, entry), 'utf8');
      const meta = source.match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0];
      const bootstrap = source.match(
        /<script(?: id="lingua-theme-bootstrap")?>([\s\S]*?)<\/script>/
      )?.[0];
      expect(meta).toBeDefined();
      expect(bootstrap).toBeDefined();
      const fixture = await mkdtemp(path.join(os.tmpdir(), 'lingua-csp-build-'));
      try {
        await writeFile(
          path.join(fixture, 'index.html'),
          `<!doctype html><html><head>${meta}${bootstrap}</head><body><script type="module" src="./entry.js"></script></body></html>`
        );
        const sandbox = path.join(root, 'src/renderer/runtime/lingua-sandbox.htm');
        await writeFile(
          path.join(fixture, 'entry.js'),
          `import sandboxUrl from ${JSON.stringify(sandbox.replaceAll('\\', '/') + '?url&no-inline')}; document.documentElement.dataset.sandbox = sandboxUrl;`
        );
        await build({
          configFile: false,
          root: fixture,
          plugins: plugin ? [plugin] : [],
          logLevel: 'silent',
          build: { minify: true },
        });
        const html = await readFile(path.join(fixture, 'dist/index.html'), 'utf8');
        const assets = await readdir(path.join(fixture, 'dist/assets'));
        const sandboxAsset = assets.find(name => /^lingua-sandbox-[\w-]+\.htm$/.test(name));
        expect(sandboxAsset).toBeDefined();
        expect(await readFile(path.join(fixture, 'dist/assets', sandboxAsset!), 'utf8')).toBe(
          await readFile(sandbox, 'utf8')
        );
        const policy = html.match(/content="([^"]*script-src[^"]*)"/)?.[1] ?? '';
        const scriptPolicy = policy.split(';').find(part => part.trim().startsWith('script-src '));
        expect(scriptPolicy).not.toContain("'unsafe-inline'");
        expect(scriptPolicy).toContain("'self'");
        expect(scriptPolicy).toContain("'unsafe-eval'");
        expect(policy).toContain("style-src 'self' 'unsafe-inline'");
        const body = html.match(/<script id="lingua-theme-bootstrap">([\s\S]*?)<\/script>/)?.[1];
        expect(body).toBeDefined();
        const hash = createHash('sha256').update(body!).digest('base64');
        expect(scriptPolicy).toContain(`'sha256-${hash}'`);
        expect(scriptPolicy).not.toContain(
          `'sha256-${createHash('sha256').update(`${body} `).digest('base64')}'`
        );
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    });

    it('does not apply production hashing to the development HMR document', async () => {
      const config = await resolveConfig(
        { configFile: path.join(root, configFile), logLevel: 'silent' },
        'serve'
      );
      expect(config.plugins.some(plugin => plugin.name === 'lingua-shell-csp')).toBe(false);
    });
  });
}

describe('fail-closed shell policy generation', () => {
  const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval';"><script id="lingua-theme-bootstrap">window.theme = 1;</script>`;
  it('normalizes browser line endings and is idempotent', async () => {
    const { hardenShellCsp } = await import('../../build/shellCsp.mts');
    const result = hardenShellCsp(html.replace('window.theme', '\r\nwindow.theme'));
    const hash = createHash('sha256').update('\nwindow.theme = 1;').digest('base64');
    expect(result).toContain(`'sha256-${hash}'`);
    expect(hardenShellCsp(result)).toBe(result);
  });
  it.each([
    html.replace('id="lingua-theme-bootstrap"', ''),
    html + '<script id="lingua-theme-bootstrap">other()</script>',
    html + '<script>unexpected()</script>',
    html.replace("default-src 'self';", "script-src-elem 'unsafe-inline';"),
    html.replace("default-src 'self';", "script-src-attr 'unsafe-inline';"),
    html.replace("default-src 'self';", "script-src 'unsafe-inline';"),
    html.replace('content=', 'other='),
    html + '<meta http-equiv="Content-Security-Policy" content="script-src *">',
  ])('rejects a malformed or ambiguous shell template', async input => {
    const { hardenShellCsp } = await import('../../build/shellCsp.mts');
    expect(() => hardenShellCsp(input)).toThrow();
  });
});
